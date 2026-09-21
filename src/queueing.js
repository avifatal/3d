// Object queue & matrix: one form, repeated along a path or over a sheet.
//
// The exercise this comes from calls it "sliced perspective" — the forms in a
// queue are slices cut out of one longer volume, so they are identical and
// evenly spaced, and everything that changes between them is perspective.
// That is the whole point, and it is why nothing here randomises the forms
// individually: give them different proportions and the reader can no longer
// tell which differences are the drawing and which are the object.
//
// What the levels vary is the *path*. A straight run is the plain case; an
// arc bends it; a free curve bends it in every direction at once. Each form
// is turned by the frame of the path where it sits, so a queue reads as a
// bent volume that has been sliced rather than a row of separate things.
//
// The forms float rather than resting on anything. The horizon is the eye
// line, and this exercise is about how much of a plane is revealed by its
// distance from that line, so an arrangement has to be free to sit above it,
// below it and across it. Nothing in here touches the ground.
//
// And no two forms ever share space. That is solved rather than eyeballed:
// see `solveSpacing`.

import { CatmullRomCurve3, Matrix4, Quaternion, Vector3 } from 'three';
import { extentAlong, obbSeparation } from './stacking.js';

export const LEVELS = [
	{
		id: 'easier',
		label: 'Easier',
		note: {
			queue: 'A straight run of identical forms, evenly spaced.',
			matrix: 'A flat sheet of identical forms, in even rows and columns.',
		},
	},
	{
		id: 'harder',
		label: 'Harder',
		note: {
			queue: 'The run bends along a circular arc, and every form turns with it.',
			matrix: 'The sheet curves one way, like a grid cut out of a cylinder.',
		},
	},
	{
		id: 'hardest',
		label: 'Hardest',
		note: {
			queue: 'The run follows a free curve through space, and each form is turned a little off it.',
			matrix: 'The sheet saddles — curving one way across and the other way down — with each form turned a little off it.',
		},
	},
];

export const ARRANGEMENTS = [
	{ id: 'queue', label: 'Queue' },
	{ id: 'matrix', label: 'Matrix' },
];

// A sphere is left out on purpose: it has no planes to reveal, so a queue of
// them demonstrates nothing about the thing being studied.
export const SHAPE_IDS = [ 'box', 'boxProportions', 'pyramid', 'cone' ];

/**
 * Which of the form's own axes the caller should lay its *smallest* dimension
 * along, so a slab reads the way the exercise intends: sliced across the run
 * in a queue, and facing out of the sheet in a matrix.
 */
export const THIN_AXIS = { queue: 'x', matrix: 'z' };

const CONFIG = {
	queue: {
		easier: { count: [ 5, 8 ], path: 'straight', gap: [ 0.25, 0.55 ], jitter: 0 },
		harder: { count: [ 6, 10 ], path: 'arc', angle: [ 40, 145 ], gap: [ 0.2, 0.5 ], jitter: 0 },
		hardest: { count: [ 8, 13 ], path: 'spline', controls: [ 4, 6 ], turn: 55, reach: 0.62, gap: [ 0.18, 0.45 ], jitter: 11 },
	},
	matrix: {
		easier: { rows: [ 2, 3 ], columns: [ 3, 5 ], gap: [ 0.3, 0.6 ], sag: [ 0, 0 ], cross: [ 0, 0 ], tilt: 0, jitter: 0 },
		harder: { rows: [ 2, 4 ], columns: [ 4, 6 ], gap: [ 0.25, 0.5 ], sag: [ 0.18, 0.42 ], cross: [ 0, 0 ], tilt: 14, jitter: 0 },
		hardest: { rows: [ 3, 4 ], columns: [ 4, 6 ], gap: [ 0.2, 0.45 ], sag: [ 0.2, 0.45 ], cross: [ 0.15, 0.4 ], tilt: 26, jitter: 9 },
	},
};

const DEG = Math.PI / 180;
const UP = new Vector3( 0, 1, 0 );
const X = new Vector3( 1, 0, 0 );
const Y = new Vector3( 0, 1, 0 );
const Z = new Vector3( 0, 0, 1 );

const range = ( rng, min, max ) => min + rng() * ( max - min );
const randInt = ( rng, min, max ) => min + Math.floor( rng() * ( max - min + 1 ) );
const sign = rng => ( rng() < 0.5 ? - 1 : 1 );

/** A magnitude drawn from `[min, max]`, then given a random sign. */
const signed = ( rng, span ) => range( rng, span[ 0 ], span[ 1 ] ) * sign( rng );

const _basis = new Matrix4();

function randomDirection( rng ) {
	// Rejection-sample the cube down to the ball so no direction is favoured.
	const v = new Vector3();
	do {
		v.set( rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1 );
	} while ( v.lengthSq() > 1 || v.lengthSq() < 1e-6 );
	return v.normalize();
}

/**
 * The orientation whose local +X runs along `xAxis` and whose local +Y is as
 * close to `yHint` as being perpendicular allows. This is what turns "follow
 * the path" into an exact quaternion: the path supplies the axis, the hint
 * supplies which way is up, and no roll is introduced anywhere.
 */
function basisFrom( xAxis, yHint ) {
	const x = xAxis.clone().normalize();

	// A run straight up has no "up" left to hint with; anything perpendicular
	// will do, and it has to be chosen rather than left to produce a zero.
	let reference = yHint.clone().normalize();
	if ( Math.abs( x.dot( reference ) ) > 0.999 ) reference = Math.abs( x.y ) > 0.9 ? Z.clone() : Y.clone();

	const y = reference.addScaledVector( x, - reference.dot( x ) ).normalize();
	const z = new Vector3().crossVectors( x, y );

	return new Quaternion().setFromRotationMatrix( _basis.makeBasis( x, y, z ) );
}

/**
 * Per-form rotations off the path frame, drawn once and reused at every
 * spacing the solver tries. Drawing them inside the solver instead would
 * change the arrangement under it and there would be nothing to converge on.
 */
function jitterList( rng, count, degrees ) {
	const list = [];

	for ( let i = 0; i < count; i ++ ) {
		list.push( degrees
			? new Quaternion().setFromAxisAngle( randomDirection( rng ), range( rng, - degrees, degrees ) * DEG )
			: new Quaternion() );
	}

	return list;
}

// --- paths -----------------------------------------------------------------
//
// Each path factory draws its shape from the rng once and returns a function
// of total length, so the solver can stretch the same shape without changing
// it. All three are parameterised by arc length: `pointAt( u )` at evenly
// spaced `u` gives evenly spaced forms, bend or no bend.

function straightPath( rng ) {
	// Horizontal, diagonal or straight up. A horizontal run demonstrates the
	// left/right axis of vision, a vertical one the up/down axis; the workbook
	// draws both, so both come up.
	const azimuth = rng() * Math.PI * 2;
	const choice = rng();
	const pitch = choice < 0.34 ? 0
		: choice < 0.72 ? range( rng, 22, 58 ) * DEG * sign( rng )
			: Math.PI / 2;

	const direction = new Vector3(
		Math.cos( pitch ) * Math.cos( azimuth ),
		Math.sin( pitch ),
		Math.cos( pitch ) * Math.sin( azimuth ),
	).normalize();

	return length => ( {
		pointAt: u => direction.clone().multiplyScalar( ( u - 0.5 ) * length ),
		tangentAt: () => direction.clone(),
	} );
}

function arcPath( rng, cfg ) {
	const angle = range( rng, cfg.angle[ 0 ], cfg.angle[ 1 ] ) * DEG * sign( rng );

	// The run direction, and the axis it bends about — any axis perpendicular
	// to the run, so the arc can lie flat like a road or stand up like a
	// rainbow, or anything between.
	const run = randomDirection( rng );
	const axis = randomDirection( rng ).cross( run );
	if ( axis.lengthSq() < 1e-6 ) axis.copy( Math.abs( run.y ) > 0.9 ? Z : Y ).cross( run );
	axis.normalize();

	const sideways = new Vector3().crossVectors( axis, run ).normalize();

	return length => {
		const radius = length / Math.abs( angle );

		return {
			pointAt: u => {
				const phi = ( u - 0.5 ) * angle;
				return run.clone().multiplyScalar( radius * Math.sin( phi ) )
					.addScaledVector( sideways, radius * ( Math.cos( phi ) - 1 ) );
			},
			tangentAt: u => {
				const phi = ( u - 0.5 ) * angle;
				return run.clone().multiplyScalar( Math.cos( phi ) )
					.addScaledVector( sideways, - Math.sin( phi ) );
			},
		};
	};
}

/** One random walk of unit steps, turning by at most `turn` at each. */
function walk( rng, count, turn ) {
	const direction = randomDirection( rng );
	const controls = [ new Vector3() ];

	for ( let i = 1; i < count; i ++ ) {
		const axis = randomDirection( rng ).cross( direction );
		if ( axis.lengthSq() > 1e-6 ) direction.applyAxisAngle( axis.normalize(), range( rng, - turn, turn ) * DEG ).normalize();
		controls.push( controls[ i - 1 ].clone().add( direction ) );
	}

	return controls;
}

function splinePath( rng, cfg ) {
	// A random walk with a limited turn per step: control points drawn at
	// random instead fold the curve back through itself, and the spacing
	// solver can only answer that by blowing the whole arrangement apart.
	//
	// Even a limited turn doubles back if it keeps turning the same way, and
	// a run that comes back towards the viewer stacks up behind itself and
	// reads as a heap rather than a queue. So the walk is judged on how far
	// it actually gets — end to end, against the distance travelled — and
	// redrawn when it gets nowhere. The straightest attempt is kept if none
	// of them do, since a free curve still has to be a *run*.
	const count = randInt( rng, cfg.controls[ 0 ], cfg.controls[ 1 ] );
	const span = candidate => candidate[ candidate.length - 1 ].length() / ( candidate.length - 1 );

	let controls = walk( rng, count, cfg.turn );
	for ( let i = 0; i < 12 && span( controls ) < cfg.reach; i ++ ) {
		const next = walk( rng, count, cfg.turn );
		if ( span( next ) > span( controls ) ) controls = next;
	}

	const unit = new CatmullRomCurve3( controls, false, 'centripetal' );
	const unitLength = unit.getLength();

	return length => {
		const scale = length / unitLength;
		const curve = new CatmullRomCurve3( controls.map( point => point.clone().multiplyScalar( scale ) ), false, 'centripetal' );

		return {
			pointAt: u => curve.getPointAt( u ),
			tangentAt: u => curve.getTangentAt( u ),
		};
	};
}

const PATHS = { straight: straightPath, arc: arcPath, spline: splinePath };

// --- layouts ---------------------------------------------------------------

function queueLayout( cfg, size, rng ) {
	const count = randInt( rng, cfg.count[ 0 ], cfg.count[ 1 ] );
	const gapRatio = range( rng, cfg.gap[ 0 ], cfg.gap[ 1 ] );
	const pitch = size.x * ( 1 + gapRatio );
	const jitters = jitterList( rng, count, cfg.jitter );
	const path = PATHS[ cfg.path ]( rng, cfg );

	const build = scale => {
		const curve = path( pitch * scale * ( count - 1 ) );
		const items = [];

		for ( let i = 0; i < count; i ++ ) {
			const u = i / ( count - 1 );
			items.push( {
				size,
				position: curve.pointAt( u ),
				quaternion: basisFrom( curve.tangentAt( u ), UP ).multiply( jitters[ i ] ),
				index: i,
				row: 0,
				column: i,
			} );
		}

		return items;
	};

	return { build, target: size.x * gapRatio, rows: 1, columns: count };
}

function matrixLayout( cfg, size, rng ) {
	const rows = randInt( rng, cfg.rows[ 0 ], cfg.rows[ 1 ] );
	const columns = randInt( rng, cfg.columns[ 0 ], cfg.columns[ 1 ] );
	const gapRatio = range( rng, cfg.gap[ 0 ], cfg.gap[ 1 ] );
	const pitchU = size.x * ( 1 + gapRatio );
	const pitchV = size.y * ( 1 + gapRatio );
	const jitters = jitterList( rng, rows * columns, cfg.jitter );

	// The sheet stands up rather than lying down, so its rows sit above and
	// below eye level and its columns run left and right of the centre of
	// vision — the two axes the exercise is about, in one arrangement.
	const azimuth = rng() * Math.PI * 2;
	const across = new Vector3( Math.cos( azimuth ), 0, Math.sin( azimuth ) );
	const upward = UP.clone().applyAxisAngle( across, range( rng, - cfg.tilt, cfg.tilt ) * DEG ).normalize();
	const normal = new Vector3().crossVectors( across, upward ).normalize();

	const sag = signed( rng, cfg.sag );
	const cross = signed( rng, cfg.cross );

	const build = scale => {
		const halfU = pitchU * scale * ( columns - 1 ) / 2;
		const halfV = pitchV * scale * ( rows - 1 ) / 2;

		// Curvature is re-derived from the sheet's current reach every time,
		// so stretching it keeps the same shape: `sag` is how far the edge of
		// the sheet stands off the flat, as a fraction of the reach to it.
		const ka = halfU > 1e-9 ? 2 * sag / halfU : 0;
		const kb = halfV > 1e-9 ? 2 * cross / halfV : 0;

		const items = [];

		for ( let row = 0; row < rows; row ++ ) {
			for ( let column = 0; column < columns; column ++ ) {
				const a = columns > 1 ? - halfU + column * ( 2 * halfU ) / ( columns - 1 ) : 0;
				const b = rows > 1 ? - halfV + row * ( 2 * halfV ) / ( rows - 1 ) : 0;

				const position = across.clone().multiplyScalar( a )
					.addScaledVector( upward, b )
					.addScaledVector( normal, 0.5 * ka * a * a - 0.5 * kb * b * b );

				// The surface's own tangents, so each form lies in the sheet
				// exactly rather than approximately.
				const alongU = across.clone().addScaledVector( normal, ka * a );
				const alongV = upward.clone().addScaledVector( normal, - kb * b );

				const index = row * columns + column;
				items.push( {
					size,
					position,
					quaternion: basisFrom( alongU, alongV ).multiply( jitters[ index ] ),
					index,
					row,
					column,
				} );
			}
		}

		return items;
	};

	return { build, target: Math.min( size.x, size.y ) * gapRatio, rows, columns };
}

const LAYOUTS = { queue: queueLayout, matrix: matrixLayout };

// --- spacing ---------------------------------------------------------------

/** The closest approach between any two forms: > 0 apart, < 0 sharing space. */
function minSeparation( items ) {
	let nearest = Infinity;

	for ( let i = 0; i < items.length; i ++ ) {
		for ( let j = i + 1; j < items.length; j ++ ) {
			nearest = Math.min( nearest, obbSeparation( items[ i ], items[ j ] ) );
		}
	}

	return nearest;
}

/**
 * The one guarantee this file owes the rest of the app is that no two forms
 * share space, and a bend is exactly where spacing them by eye goes wrong:
 * forms evenly spaced along an arc close up on the inside of the turn.
 *
 * So the arrangement is built as a one-parameter family. Everything that
 * gives it its shape — the bend angle, the control points, the per-form
 * jitter — is drawn before this runs, and `build( scale )` lays that same
 * shape out larger or smaller. Separation then grows with scale and can be
 * solved for: expand until the forms are clear, then bisect for the tightest
 * spacing that still is.
 *
 * Convergence is from the clear side on purpose. The layout returned is
 * always one that was measured apart, so rounding can only ever leave a hair
 * more daylight than asked for, never an overlap.
 */
function solveSpacing( build, target ) {
	const separation = scale => minSeparation( build( scale ) );

	let clear = 1;
	let tight = 1;

	if ( separation( clear ) < target ) {

		while ( separation( clear ) < target && clear < 1e4 ) clear *= 1.5;
		tight = clear / 1.5;

	} else {

		while ( separation( tight ) >= target && tight > 1e-4 ) tight /= 1.5;

	}

	for ( let i = 0; i < 48; i ++ ) {
		const mid = ( tight + clear ) / 2;
		if ( separation( mid ) >= target ) clear = mid; else tight = mid;
	}

	return build( clear );
}

/**
 * Put the arrangement's bounding box on the origin. The camera frames the
 * scene on its centre and the horizon is the eye line, so centring here is
 * what puts eye level through the middle of the arrangement.
 */
function centreOnOrigin( items ) {
	const min = new Vector3( Infinity, Infinity, Infinity );
	const max = new Vector3( - Infinity, - Infinity, - Infinity );
	const reach = new Vector3();

	for ( const item of items ) {
		const half = item.size.clone().multiplyScalar( 0.5 );
		reach.set(
			extentAlong( item.quaternion, half, X ),
			extentAlong( item.quaternion, half, Y ),
			extentAlong( item.quaternion, half, Z ),
		);
		min.min( item.position.clone().sub( reach ) );
		max.max( item.position.clone().add( reach ) );
	}

	const centre = min.add( max ).multiplyScalar( 0.5 );
	for ( const item of items ) item.position.sub( centre );

	return items;
}

/**
 * @param {'queue'|'matrix'} arrangement
 * @param {string} levelId
 * @param {Vector3} size  the repeated form's own extents, smallest dimension
 *   already laid along `THIN_AXIS[ arrangement ]`.
 * @returns {{ items: Array<{ size, position, quaternion, index, row, column }>,
 *   rows: number, columns: number, gap: number }}
 */
export function generateQueue( arrangement, levelId, size, rng = Math.random ) {
	const cfg = CONFIG[ arrangement ]?.[ levelId ];
	if ( ! cfg ) throw new Error( `unknown arrangement or level "${arrangement}/${levelId}"` );

	const { build, target, rows, columns } = LAYOUTS[ arrangement ]( cfg, size, rng );
	const items = centreOnOrigin( solveSpacing( build, target ) );

	return { items, rows, columns, gap: target };
}
