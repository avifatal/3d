// Where to drop a new form so the result is worth drawing.
//
// A random transform almost never produces a useful exercise: forms miss each
// other, graze tangentially, or swallow one another whole. So a candidate is
// aimed at a point sampled on an existing surface, pushed in to a random
// depth, and then actually tested - the real intersection curve is computed
// and the placement is rejected unless that curve exists, is long enough to
// draw, and the overlap is neither a shaving nor near-total containment.

import { Box3, Matrix4, Quaternion, Vector3 } from 'three';
import { intersectionCurves, makeBrush, meshVolume } from './intersections.js';

const MAX_SAMPLES = 60;
const MAX_EVALUATIONS = 14;
const EAGER_EVALUATIONS = 4;   // hold out for a good score this many times

const MIN_OVERLAP = 0.035;     // as a fraction of the smaller solid's volume
const MAX_OVERLAP = 0.60;
const CONTAINMENT = 0.92;
const MIN_CURVE_LENGTH = 0.4;
const IDEAL_OVERLAP = 0.2;
const SCORE_FLOOR = 2.5;
const SCENE_RADIUS = 4.2;

const range = ( rng, min, max ) => min + rng() * ( max - min );

/** Shoemake's uniform random rotation. */
function randomQuaternion( rng, target ) {

	const u1 = rng(), u2 = rng(), u3 = rng();
	const a = Math.sqrt( 1 - u1 ), b = Math.sqrt( u1 );
	return target.set(
		a * Math.sin( 2 * Math.PI * u2 ),
		a * Math.cos( 2 * Math.PI * u2 ),
		b * Math.sin( 2 * Math.PI * u3 ),
		b * Math.cos( 2 * Math.PI * u3 ),
	);

}

/**
 * Area-weighted sampler over a world-baked surface, so big faces are hit as
 * often as their area warrants instead of once per triangle.
 */
export function buildSurfaceSampler( geometry ) {

	const position = geometry.getAttribute( 'position' );
	const index = geometry.getIndex();
	const count = index ? index.count / 3 : position.count / 3;

	const cumulative = new Float64Array( count );
	const a = new Vector3(), b = new Vector3(), c = new Vector3();
	const ab = new Vector3(), ac = new Vector3(), cross = new Vector3();
	let total = 0;

	const corner = ( triangle, k, target ) => {

		const i = index ? index.getX( 3 * triangle + k ) : 3 * triangle + k;
		return target.fromBufferAttribute( position, i );

	};

	for ( let t = 0; t < count; t ++ ) {

		corner( t, 0, a ); corner( t, 1, b ); corner( t, 2, c );
		ab.subVectors( b, a );
		ac.subVectors( c, a );
		total += cross.crossVectors( ab, ac ).length() / 2;
		cumulative[ t ] = total;

	}

	return ( rng, point, normal ) => {

		const target = rng() * total;
		let low = 0, high = count - 1;
		while ( low < high ) {

			const mid = ( low + high ) >> 1;
			if ( cumulative[ mid ] < target ) low = mid + 1;
			else high = mid;

		}

		corner( low, 0, a ); corner( low, 1, b ); corner( low, 2, c );

		let u = rng(), v = rng();
		if ( u + v > 1 ) { u = 1 - u; v = 1 - v; }

		ab.subVectors( b, a );
		ac.subVectors( c, a );
		point.copy( a ).addScaledVector( ab, u ).addScaledVector( ac, v );
		normal.copy( cross.crossVectors( ab, ac ) ).normalize();

		return point;

	};

}

function overlapQuality( ratio ) {

	if ( ratio <= 0 ) return 0;
	// Falls off symmetrically in log space either side of the ideal overlap.
	const decades = Math.abs( Math.log( ratio / IDEAL_OVERLAP ) ) / Math.log( 6 );
	return Math.max( 0, 1 - decades );

}

/**
 * @param {{geometry, radius}} shape freshly created, still at the origin
 * @param {Array} forms existing forms: { id, geometry, brush, box, volume, sampler, centre }
 * @returns {null|{matrix, geometry, brush, volume, box, pairs}}
 */
export function findPlacement( shape, forms, rng ) {

	const quaternion = new Quaternion();
	const position = new Vector3();
	const scale = new Vector3( 1, 1, 1 );
	const matrix = new Matrix4();
	const surfacePoint = new Vector3();
	const surfaceNormal = new Vector3();
	const tangentU = new Vector3();
	const tangentV = new Vector3();

	// The very first form has nothing to intersect; seat it at the origin.
	if ( forms.length === 0 ) {

		randomQuaternion( rng, quaternion );
		matrix.compose( new Vector3(), quaternion, scale );
		const geometry = shape.geometry.clone().applyMatrix4( matrix );
		return {
			matrix,
			geometry,
			brush: makeBrush( geometry ),
			volume: meshVolume( geometry ),
			box: new Box3().setFromBufferAttribute( geometry.getAttribute( 'position' ) ),
			pairs: [],
		};

	}

	// Prefer forms that are not already crowded with intersections.
	const weights = forms.map( form => 1 / ( 1 + form.links ) );
	const weightTotal = weights.reduce( ( a, b ) => a + b, 0 );

	const pickTarget = () => {

		let roll = rng() * weightTotal;
		for ( let i = 0; i < forms.length; i ++ ) {

			roll -= weights[ i ];
			if ( roll <= 0 ) return forms[ i ];

		}

		return forms[ forms.length - 1 ];

	};

	let best = null;
	let evaluations = 0;

	for ( let sample = 0; sample < MAX_SAMPLES && evaluations < MAX_EVALUATIONS; sample ++ ) {

		const target = pickTarget();
		target.sampler( rng, surfacePoint, surfaceNormal );

		// Penetration depth: 0.5 puts the new centre on the surface.
		const penetration = range( rng, 0.25, 0.65 );
		const reach = shape.radius * ( 1 - 2 * penetration );

		tangentU.set( surfaceNormal.y, - surfaceNormal.z, surfaceNormal.x ).cross( surfaceNormal ).normalize();
		tangentV.crossVectors( surfaceNormal, tangentU );
		const spread = Math.min( shape.radius, target.radius ) * 0.9;

		position.copy( surfacePoint )
			.addScaledVector( surfaceNormal, reach )
			.addScaledVector( tangentU, range( rng, - spread, spread ) )
			.addScaledVector( tangentV, range( rng, - spread, spread ) );

		if ( position.length() > SCENE_RADIUS ) continue;

		randomQuaternion( rng, quaternion );
		matrix.compose( position, quaternion, scale );

		const geometry = shape.geometry.clone().applyMatrix4( matrix );
		const box = new Box3().setFromBufferAttribute( geometry.getAttribute( 'position' ) );

		const touching = forms.filter( form => form.box.intersectsBox( box ) );
		if ( touching.length === 0 ) {

			geometry.dispose();
			continue;

		}

		evaluations ++;

		const brush = makeBrush( geometry );
		const volume = meshVolume( geometry );
		const pairs = [];
		let score = 0;
		let contained = false;
		let curveLength = 0;

		for ( const form of touching ) {

			const result = intersectionCurves( brush, form.brush );
			if ( ! result ) continue;

			const ratio = result.volume / Math.min( volume, form.volume );
			if ( ratio > CONTAINMENT ) { contained = true; break; }
			if ( result.polylines.length === 0 ) continue;
			if ( ratio < MIN_OVERLAP || ratio > MAX_OVERLAP ) continue;

			pairs.push( { form, polylines: result.polylines, ratio, length: result.length } );
			curveLength += result.length;
			score += result.length * overlapQuality( ratio );

		}

		if ( contained || pairs.length === 0 || curveLength < MIN_CURVE_LENGTH ) {

			geometry.dispose();
			continue;

		}

		// Touching two forms at once makes for a far better drawing problem.
		if ( pairs.length > 1 ) score *= 1.35;

		const candidate = {
			matrix: matrix.clone(),
			geometry,
			brush,
			volume,
			box,
			pairs,
			score,
		};

		if ( ! best || score > best.score ) {

			if ( best ) best.geometry.dispose();
			best = candidate;

		} else {

			geometry.dispose();

		}

		// Settle for a merely valid placement only once the good ones have
		// had their chances.
		if ( score >= SCORE_FLOOR || evaluations >= EAGER_EVALUATIONS ) break;

	}

	return best;

}
