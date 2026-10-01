// Intersection curves are the segments where triangles of the two original
// surfaces meet. Read them before boolean clipping can introduce T-junctions
// or sliver triangles; CSG is used only to measure the overlapping volume.

import { Line3, Matrix4, MeshBasicMaterial } from 'three';
import { Brush, Evaluator, INTERSECTION, SUBTRACTION, computeMeshVolume } from 'three-bvh-csg';
import { chainSegments, edgeKey, weldPositions } from './geomutil.js';

const evaluator = new Evaluator();
evaluator.attributes = [ 'position' ];
evaluator.useGroups = false;

const MATERIAL_A = new MeshBasicMaterial();

/**
 * Carving retains the boolean result for rendering, so it also carries
 * normals through the operation to keep curved walls smooth.
 */
const carver = new Evaluator();
carver.attributes = [ 'position', 'normal' ];
carver.useGroups = false;

/** Wrap a world-baked geometry as a Brush with an identity transform. */
export function makeBrush( geometry ) {

	const brush = new Brush( geometry, MATERIAL_A );
	brush.updateMatrixWorld( true );
	return brush;

}

/**
 * `solid` with `tool` carved out of it, as a world-baked geometry ready for
 * `FormScene.createForm()`, or `null` if the boolean failed or removed
 * everything. The caller decides whether the cut was worth keeping; this only
 * reports what it produced.
 */
export function subtract( solid, tool ) {

	let result;
	try {

		result = carver.evaluate( solid, tool, SUBTRACTION );

	} catch ( error ) {

		console.warn( 'CSG subtraction failed', error );
		return null;

	}

	const geometry = result.geometry;
	const position = geometry.getAttribute( 'position' );
	if ( ! position || position.count < 3 ) return null;

	geometry.clearGroups();
	return geometry;

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

	let result;
	try {

		result = evaluator.evaluate( brushA, brushB, INTERSECTION );

	} catch ( error ) {

		console.warn( 'CSG evaluation failed', error );
		return null;

	}

	const geometry = result.geometry;
	const position = geometry.getAttribute( 'position' );
	if ( ! position || position.count === 0 ) {

		geometry.dispose();
		return null;

	}

	const volume = meshVolume( geometry );
	geometry.dispose();

	const points = [];
	const edge = new Line3();
	const toA = new Matrix4().copy( brushA.matrixWorld ).invert().multiply( brushB.matrixWorld );
	// Evaluating the boolean above prepares both brushes' acceleration trees.
	brushA.geometry.boundsTree.bvhcast( brushB.geometry.boundsTree, toA, {

		intersectsTriangles( a, b ) {

			// Coplanar contact returns a zero-length segment. It is not a seam
			// crossing the surfaces, nor is a single point of tangency.
			if ( a.intersectsTriangle( b, edge, true ) && edge.distanceSq() > eps * eps ) {

				edge.start.applyMatrix4( brushA.matrixWorld );
				edge.end.applyMatrix4( brushA.matrixWorld );
				points.push( ...edge.start, ...edge.end );

			}
			return false;

		},

	} );

	const { verts, ids } = weldPositions( points, points.length / 3, eps );
	const border = [];
	const seen = new Set();
	for ( let i = 0; i < ids.length; i += 2 ) {

		const a = ids[ i ], b = ids[ i + 1 ];
		const key = edgeKey( a, b );
		if ( a === b || seen.has( key ) ) continue;
		seen.add( key );
		border.push( [ a, b ] );

	}

	const chains = chainSegments( border, verts );
	const candidates = [];

	for ( const chain of chains ) {

		if ( chain.length < 2 ) continue;

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

		candidates.push( { flat, chainLength } );

	}

	// Every segment comes from both source surfaces, so even short branches
	// are real. Filtering them by length can punch visible holes in a seam.
	const polylines = [];
	let length = 0;

	for ( const { flat, chainLength } of candidates ) {

		polylines.push( flat );
		length += chainLength;

	}

	return { polylines, volume, length };

}
