// Exact intersection curves between two solids.
//
// A boolean INTERSECTION of A and B produces a solid whose surface is made of
// two patches: triangles carved out of A's surface, and triangles carved out of
// B's. The curve where the two originals meet is precisely the border between
// those two patches, so instead of guessing which result edges are "seams" we
// tag the source of every triangle (via material groups) and take the boundary
// of the A-patch. That boundary is exact, closed, and free of the interior
// tessellation noise that naive edge extraction picks up.

import { MeshBasicMaterial } from 'three';
import { Brush, Evaluator, INTERSECTION, computeMeshVolume } from 'three-bvh-csg';
import { chainSegments, edgeKey, triangleIndices, weldPositions } from './geomutil.js';

const evaluator = new Evaluator();
evaluator.attributes = [ 'position' ];
evaluator.useGroups = true;
// Both must stay off: consolidation would merge A's and B's groups (they share
// a material type) and material pruning would renumber them.
evaluator.consolidateGroups = false;
evaluator.removeUnusedMaterials = false;

const MATERIAL_A = new MeshBasicMaterial();
const MATERIAL_B = new MeshBasicMaterial();

// Curve branches shorter than this fraction of the longest branch are CSG noise.
const FRAGMENT_RATIO = 0.06;

/** Wrap a world-baked geometry as a Brush with an identity transform. */
export function makeBrush( geometry ) {

	const brush = new Brush( geometry, MATERIAL_A );
	brush.updateMatrixWorld( true );
	return brush;

}

export function meshVolume( geometry ) {

	return Math.abs( computeMeshVolume( geometry ) );

}

/**
 * @returns {null|{polylines: Float32Array[], volume: number, length: number}}
 *   `polylines` are flat world-space xyz triples, ordered, closed loops
 *   repeating their first point. An empty `polylines` with a non-zero `volume`
 *   means one solid is wholly inside the other, which has no visible seam.
 *   `null` means the solids do not touch at all.
 */
export function intersectionCurves( brushA, brushB, eps = 1e-5 ) {

	brushA.material = MATERIAL_A;
	brushB.material = MATERIAL_B;

	let result;
	try {

		result = evaluator.evaluate( brushA, brushB, INTERSECTION );

	} catch ( error ) {

		console.warn( 'CSG evaluation failed', error );
		return null;

	}

	const geometry = result.geometry;
	const position = geometry.getAttribute( 'position' );
	if ( ! position || position.count === 0 ) return null;

	const materials = Array.isArray( result.material ) ? result.material : [ result.material ];
	const indices = triangleIndices( geometry );
	const totalTriangles = indices.length / 3;

	// Triangle ranges that came from A's original surface.
	const fromA = new Uint8Array( totalTriangles );
	const groups = geometry.groups;
	if ( groups.length === 0 ) {

		fromA.fill( 1 );

	} else {

		for ( const group of groups ) {

			if ( materials[ group.materialIndex ] !== MATERIAL_A ) continue;

			const start = Math.floor( group.start / 3 );
			const count = group.count === Infinity ? totalTriangles - start : Math.floor( group.count / 3 );
			for ( let t = start; t < start + count && t < totalTriangles; t ++ ) fromA[ t ] = 1;

		}

	}

	const { verts, ids } = weldPositions( position.array, position.count, eps );

	// Count how many A-patch triangles each edge belongs to. Edges used once are
	// on the patch border, i.e. on the intersection curve.
	const counts = new Map();
	const bump = ( a, b ) => {

		if ( a === b ) return;
		const key = edgeKey( a, b );
		counts.set( key, ( counts.get( key ) || 0 ) + 1 );

	};

	for ( let t = 0; t < totalTriangles; t ++ ) {

		if ( ! fromA[ t ] ) continue;

		const a = ids[ indices[ 3 * t ] ];
		const b = ids[ indices[ 3 * t + 1 ] ];
		const c = ids[ indices[ 3 * t + 2 ] ];
		bump( a, b );
		bump( b, c );
		bump( c, a );

	}

	const border = [];
	for ( const [ key, count ] of counts ) {

		if ( count !== 1 ) continue;
		const a = Math.floor( key / 4294967296 );
		border.push( [ a, key - a * 4294967296 ] );

	}

	const volume = meshVolume( geometry );
	geometry.dispose();

	if ( border.length === 0 ) return { polylines: [], volume, length: 0 };

	const chains = chainSegments( border, verts );
	const candidates = [];
	let longest = 0;

	for ( const chain of chains ) {

		if ( chain.length < 3 ) continue;

		const flat = new Float32Array( chain.length * 3 );
		let chainLength = 0;

		for ( let i = 0; i < chain.length; i ++ ) {

			const v = chain[ i ];
			flat[ 3 * i ] = verts[ 3 * v ];
			flat[ 3 * i + 1 ] = verts[ 3 * v + 1 ];
			flat[ 3 * i + 2 ] = verts[ 3 * v + 2 ];

			if ( i > 0 ) {

				const dx = flat[ 3 * i ] - flat[ 3 * i - 3 ];
				const dy = flat[ 3 * i + 1 ] - flat[ 3 * i - 2 ];
				const dz = flat[ 3 * i + 2 ] - flat[ 3 * i - 1 ];
				chainLength += Math.sqrt( dx * dx + dy * dy + dz * dz );

			}

		}

		longest = Math.max( longest, chainLength );
		candidates.push( { flat, chainLength } );

	}

	// Drop the slivers that coincident-face splits leave behind: a genuine
	// branch of an intersection curve is never a rounding error next to the
	// main loop.
	const minLength = Math.max( 0.02, longest * FRAGMENT_RATIO );
	const polylines = [];
	let length = 0;

	for ( const { flat, chainLength } of candidates ) {

		if ( chainLength < minLength ) continue;
		polylines.push( flat );
		length += chainLength;

	}

	return { polylines, volume, length };

}
