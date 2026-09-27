// Procedural subtraction: independently sampled dimensions, corner radii,
// cutters and placements. Difficulty constrains complexity, never a template.

import {
	BoxGeometry, BufferAttribute, BufferGeometry, CylinderGeometry,
	ExtrudeGeometry, Matrix4, Shape, Vector3,
} from 'three';
import { chainSegments, repairTJunctions, triangleIndices, weldPositions } from './geomutil.js';
import { makeBrush, meshVolume, subtract } from './intersections.js';
import { buildEdgeData } from './silhouette.js';

export const GUIDES = [
	{ id: 'solid', label: 'Solid' },
	{ id: 'cuts', label: 'Solid + cuts' },
];

export const LEVELS = [
	{ id: 'easier', label: 'Easier', note: 'One generous cut with randomized placement and corner rounding.', cuts: [ 1, 1 ], pocketChance: 0, sideChance: 0 },
	{ id: 'harder', label: 'Harder', note: 'Two or three cuts with varied shapes, openings and depths.', cuts: [ 2, 3 ], pocketChance: 0.3, sideChance: 0.25 },
	{ id: 'hardest', label: 'Hardest', note: 'Three to five cuts that can meet across different faces.', cuts: [ 3, 5 ], pocketChance: 0.45, sideChance: 0.55 },
];
const range = ( rng, min, max ) => min + rng() * ( max - min );
const TARGET_RADIUS = 1.7;

/** Independently rounded profile corners, extruded without beveling the faces. */
function cornerBox( width, height, depth, radii ) {
	const [ bl, br, tr, tl ] = radii;
	const x = width / 2, y = height / 2;
	const profile = new Shape();
	profile.moveTo( - x + bl, - y );
	profile.lineTo( x - br, - y );
	if ( br ) profile.absarc( x - br, - y + br, br, - Math.PI / 2, 0, false );
	profile.lineTo( x, y - tr );
	if ( tr ) profile.absarc( x - tr, y - tr, tr, 0, Math.PI / 2, false );
	profile.lineTo( - x + tl, y );
	if ( tl ) profile.absarc( - x + tl, y - tl, tl, Math.PI / 2, Math.PI, false );
	profile.lineTo( - x, - y + bl );
	if ( bl ) profile.absarc( - x + bl, - y + bl, bl, Math.PI, Math.PI * 1.5, false );
	profile.closePath();
	return new ExtrudeGeometry( profile, { depth, bevelEnabled: false, curveSegments: 20 } )
		.translate( 0, 0, - depth / 2 );
}

function randomCorners( width, height, rng ) {
	return Array.from( { length: 4 }, () => rng() < 0.45 ? 0 : Math.min( width, height ) * range( rng, 0.06, 0.2 ) );
}

/** Sample one cutting volume, with no prearranged positions or combinations. */
function randomTool( size, level, rng, first ) {
	const axis = ! first && rng() < level.sideChance ? ( rng() < 0.5 ? 0 : 1 ) : 2;
	const u = axis === 0 ? 2 : 0;
	const v = axis === 1 ? 2 : 1;
	const w = size[ u ] * range( rng, 0.24, 0.64 );
	const h = size[ v ] * range( rng, 0.24, 0.64 );
	const x = size[ u ] * range( rng, - 0.52, 0.52 );
	const y = size[ v ] * range( rng, - 0.52, 0.52 );
	const pocket = rng() < level.pocketChance;
	const penetration = pocket ? size[ axis ] * range( rng, 0.25, 0.7 ) : size[ axis ];
	const pad = size[ axis ] * 0.12;
	const length = pocket ? penetration + pad : size[ axis ] + pad * 2;
	const z = pocket ? size[ axis ] / 2 - penetration / 2 + pad / 2 : 0;
	const curved = rng() < 0.45;
	const geometry = curved
		? new CylinderGeometry( 1, 1, length, 48 ).rotateX( Math.PI / 2 ).scale( w / 2, h / 2, 1 )
		: new BoxGeometry( w, h, length );
	geometry.translate( x, y, z );
	if ( axis === 0 ) geometry.rotateY( Math.PI / 2 );
	if ( axis === 1 ) geometry.rotateX( - Math.PI / 2 );
	return { geometry, axis, curved, pocket, width: w, height: h, x, y, penetration };
}

export function componentCount( geometry ) {

	const position = geometry.getAttribute( 'position' );
	const { verts, ids } = weldPositions( position.array, position.count, 1e-5 );
	const indices = triangleIndices( geometry );
	const parent = new Int32Array( verts.length / 3 );

	for ( let i = 0; i < parent.length; i ++ ) parent[ i ] = i;

	const find = i => {

		while ( parent[ i ] !== i ) i = parent[ i ] = parent[ parent[ i ] ];
		return i;

	};

	const union = ( i, j ) => {

		const a = find( i ), b = find( j );
		if ( a !== b ) parent[ a ] = b;

	};

	for ( let t = 0; t < indices.length; t += 3 ) {

		union( ids[ indices[ t ] ], ids[ indices[ t + 1 ] ] );
		union( ids[ indices[ t ] ], ids[ indices[ t + 2 ] ] );

	}

	const roots = new Set();
	for ( let i = 0; i < parent.length; i ++ ) roots.add( find( i ) );
	return roots.size;

}

function wireframe( geometry ) {

	const segments = buildEdgeData( geometry ).hardSegments;
	const count = segments.length / 6;
	if ( count === 0 ) return [];

	const { verts, ids } = weldPositions( segments, count * 2, 1e-5 );
	const pairs = [];
	for ( let i = 0; i < count; i ++ ) pairs.push( [ ids[ 2 * i ], ids[ 2 * i + 1 ] ] );

	return chainSegments( pairs, verts ).map( chain => {

		const out = new Float32Array( chain.length * 3 );
		for ( let i = 0; i < chain.length; i ++ ) {

			out[ 3 * i ] = verts[ 3 * chain[ i ] ];
			out[ 3 * i + 1 ] = verts[ 3 * chain[ i ] + 1 ];
			out[ 3 * i + 2 ] = verts[ 3 * chain[ i ] + 2 ];

		}

		return out;

	} );

}

function transformPolyline( points, matrix ) {

	const out = new Float32Array( points.length );
	const v = new Vector3();

	for ( let i = 0; i < points.length; i += 3 ) {

		v.set( points[ i ], points[ i + 1 ], points[ i + 2 ] ).applyMatrix4( matrix );
		out[ i ] = v.x;
		out[ i + 1 ] = v.y;
		out[ i + 2 ] = v.z;

	}

	return out;

}

function manifold( geometry ) {

	const repaired = repairTJunctions( geometry );
	if ( ! repaired ) return geometry;

	const fixed = new BufferGeometry();
	fixed.setAttribute( 'position', new BufferAttribute( repaired.position, 3 ) );
	if ( repaired.normal ) fixed.setAttribute( 'normal', new BufferAttribute( repaired.normal, 3 ) );
	else fixed.computeVertexNormals();

	geometry.dispose();
	return fixed;

}

/** Build a candidate, keeping only substantial cuts that leave a connected solid. */
function generateCandidate( rng, level ) {
	const size = [ range( rng, 1.5, 3 ), range( rng, 1.4, 2.8 ), range( rng, 1, 2.5 ) ];
	const [ width, height, depth ] = size;
	const corners = randomCorners( width, height, rng );
	let geometry = cornerBox( width, height, depth, corners );
	const startVolume = meshVolume( geometry );
	let volume = startVolume;
	const wanted = level.cuts[ 0 ] + Math.floor( rng() * ( level.cuts[ 1 ] - level.cuts[ 0 ] + 1 ) );
	const operations = [];
	const cutGhosts = [];
	const solidGhost = wireframe( geometry );

	for ( let attempt = 0; attempt < wanted * 18 && operations.length < wanted; attempt ++ ) {
		const tool = randomTool( size, level, rng, operations.length === 0 );
		const carved = subtract( makeBrush( geometry ), makeBrush( tool.geometry ) );
		const after = carved ? meshVolume( carved ) : 0;
		const bite = ( volume - after ) / startVolume;
		if ( ! carved || bite < ( operations.length ? 0.015 : 0.04 ) ||
			bite > 0.4 || after < startVolume * 0.45 || componentCount( carved ) !== 1 ) {
			carved?.dispose();
			tool.geometry.dispose();
			continue;
		}
		cutGhosts.push( ...wireframe( tool.geometry ) );
		geometry.dispose();
		geometry = carved;
		volume = after;
		tool.geometry.dispose();
		const { geometry: discarded, ...parameters } = tool;
		operations.push( parameters );
	}

	const scale = TARGET_RADIUS / ( Math.hypot( ...size ) / 2 );
	const matrix = new Matrix4().makeScale( scale, scale, scale );
	geometry = manifold( geometry );
	geometry.applyMatrix4( matrix );
	return {
		geometry, cuts: operations.length, removed: 1 - volume / startVolume,
		level: level.id, corners, operations, scale,
		ghost: {
			solid: solidGhost.map( points => transformPolyline( points, matrix ) ),
			cuts: cutGhosts.map( points => transformPolyline( points, matrix ) ),
		},
	};
}

export function generateSubtraction( rng = Math.random, levelId = 'easier' ) {
	const level = LEVELS.find( entry => entry.id === levelId );
	if ( ! level ) throw new Error( `Unknown carve level: ${levelId}` );
	// Retry a fresh randomized solid if the remaining material could not
	// accommodate enough cuts. There is no fallback to a canned arrangement.
	for ( let attempt = 0; attempt < 6; attempt ++ ) {
		const result = generateCandidate( rng, level );
		if ( result.cuts >= level.cuts[ 0 ] ) return result;
		result.geometry.dispose();
	}
	throw new Error( 'Could not generate a connected carved form at this level.' );
}
