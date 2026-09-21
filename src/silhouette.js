// Construction-drawing line extraction.
//
// Two kinds of line make a form readable on paper:
//
//   * hard edges - box corners, a cone's base rim. Fixed in space, drawn
//     always. Includes shell boundaries and non-manifold edges.
//
//   * contours - on a curved surface the outline is view dependent, so a
//     sphere has no fixed edges at all and its outline must be re-derived
//     whenever the camera moves.
//
// Contours are found by marching triangles over f(v) = n(v) · (eye - v), whose
// zero crossing is the true silhouette. Taking n from smoothed vertex normals
// rather than from face normals matters: walking whole mesh edges instead
// gives an outline that zigzags around the real contour by roughly 1% of the
// radius, which is plainly visible at drawing line weights.
//
// Vertex normals are averaged only across smooth edges, so a crease never
// blurs into its neighbour. A vertex where the surface has no single normal -
// a cone's apex - is a special case: it lies on the silhouette from every
// viewpoint, so f is pinned to zero there and the two contour lines converge
// on a sharp tip instead of stopping short of it.

import { triangleIndices, weldPositions } from './geomutil.js';

const SINGULAR_COS = Math.cos( 30 * Math.PI / 180 );

// Segments shorter than 1e-4 units are collapsed crossings, not outline.
const DEGENERATE_SQ = 1e-8;

/**
 * @param {BufferGeometry} geometry world-baked (transform already applied)
 * @param {number} creaseAngle degrees; above this an edge is drawn as hard
 */
export function buildEdgeData( geometry, creaseAngle = 18 ) {

	const position = geometry.getAttribute( 'position' );
	const { verts, ids } = weldPositions( position.array, position.count, 1e-5 );
	const indices = triangleIndices( geometry );
	const triangleCount = indices.length / 3;

	const corners = new Int32Array( triangleCount * 3 );
	const faceNormals = new Float64Array( triangleCount * 3 );

	for ( let t = 0; t < triangleCount; t ++ ) {

		const ia = ids[ indices[ 3 * t ] ];
		const ib = ids[ indices[ 3 * t + 1 ] ];
		const ic = ids[ indices[ 3 * t + 2 ] ];
		corners[ 3 * t ] = ia;
		corners[ 3 * t + 1 ] = ib;
		corners[ 3 * t + 2 ] = ic;

		const a = ia * 3, b = ib * 3, c = ic * 3;
		const abx = verts[ b ] - verts[ a ], aby = verts[ b + 1 ] - verts[ a + 1 ], abz = verts[ b + 2 ] - verts[ a + 2 ];
		const acx = verts[ c ] - verts[ a ], acy = verts[ c + 1 ] - verts[ a + 1 ], acz = verts[ c + 2 ] - verts[ a + 2 ];

		const nx = aby * acz - abz * acy;
		const ny = abz * acx - abx * acz;
		const nz = abx * acy - aby * acx;
		const length = Math.hypot( nx, ny, nz ) || 1;

		faceNormals[ 3 * t ] = nx / length;
		faceNormals[ 3 * t + 1 ] = ny / length;
		faceNormals[ 3 * t + 2 ] = nz / length;

	}

	// --- edge adjacency -----------------------------------------------------

	const edges = new Map();
	const record = ( a, b, face ) => {

		if ( a === b ) return;
		const key = a < b ? a * 4294967296 + b : b * 4294967296 + a;
		let edge = edges.get( key );
		if ( ! edge ) edges.set( key, edge = { a: Math.min( a, b ), b: Math.max( a, b ), faces: [] } );
		edge.faces.push( face );

	};

	for ( let t = 0; t < triangleCount; t ++ ) {

		record( corners[ 3 * t ], corners[ 3 * t + 1 ], t );
		record( corners[ 3 * t + 1 ], corners[ 3 * t + 2 ], t );
		record( corners[ 3 * t + 2 ], corners[ 3 * t ], t );

	}

	// --- classify edges, and union faces that share a smooth one ------------

	const parent = new Int32Array( triangleCount );
	for ( let t = 0; t < triangleCount; t ++ ) parent[ t ] = t;

	const find = x => {

		while ( parent[ x ] !== x ) x = parent[ x ] = parent[ parent[ x ] ];
		return x;

	};

	const creaseCos = Math.cos( creaseAngle * Math.PI / 180 );
	const hard = [];

	for ( const edge of edges.values() ) {

		if ( edge.faces.length !== 2 ) {

			hard.push( edge );
			continue;

		}

		const [ f0, f1 ] = edge.faces;
		const dot =
			faceNormals[ 3 * f0 ] * faceNormals[ 3 * f1 ] +
			faceNormals[ 3 * f0 + 1 ] * faceNormals[ 3 * f1 + 1 ] +
			faceNormals[ 3 * f0 + 2 ] * faceNormals[ 3 * f1 + 2 ];

		if ( dot < creaseCos ) hard.push( edge );
		else parent[ find( f0 ) ] = find( f1 );

	}

	const hardSegments = new Float32Array( hard.length * 6 );
	for ( let i = 0; i < hard.length; i ++ ) {

		const { a, b } = hard[ i ];
		hardSegments[ 6 * i ] = verts[ 3 * a ];
		hardSegments[ 6 * i + 1 ] = verts[ 3 * a + 1 ];
		hardSegments[ 6 * i + 2 ] = verts[ 3 * a + 2 ];
		hardSegments[ 6 * i + 3 ] = verts[ 3 * b ];
		hardSegments[ 6 * i + 4 ] = verts[ 3 * b + 1 ];
		hardSegments[ 6 * i + 5 ] = verts[ 3 * b + 2 ];

	}

	// --- per-patch vertex normals -------------------------------------------

	const stride = triangleCount + 1;
	const sums = new Map();

	for ( let t = 0; t < triangleCount; t ++ ) {

		const patch = find( t );
		for ( let k = 0; k < 3; k ++ ) {

			const key = corners[ 3 * t + k ] * stride + patch;
			let sum = sums.get( key );
			if ( ! sum ) sums.set( key, sum = [ 0, 0, 0 ] );
			sum[ 0 ] += faceNormals[ 3 * t ];
			sum[ 1 ] += faceNormals[ 3 * t + 1 ];
			sum[ 2 ] += faceNormals[ 3 * t + 2 ];

		}

	}

	// --- keep only triangles that can ever produce a contour ----------------

	const triPositions = [];
	const triNormals = [];
	const triSingular = [];

	for ( let t = 0; t < triangleCount; t ++ ) {

		const patch = find( t );
		const fx = faceNormals[ 3 * t ], fy = faceNormals[ 3 * t + 1 ], fz = faceNormals[ 3 * t + 2 ];

		const cornerNormals = [];
		const cornerSingular = [];
		let curved = false;

		for ( let k = 0; k < 3; k ++ ) {

			const sum = sums.get( corners[ 3 * t + k ] * stride + patch );
			const length = Math.hypot( sum[ 0 ], sum[ 1 ], sum[ 2 ] ) || 1;
			const nx = sum[ 0 ] / length, ny = sum[ 1 ] / length, nz = sum[ 2 ] / length;

			const singular = nx * fx + ny * fy + nz * fz < SINGULAR_COS;
			cornerSingular.push( singular ? 1 : 0 );

			// Loose enough to survive float32 round-off from baking a rotation
			// into the vertices, tight enough that real curvature still counts:
			// a tessellated sphere's normals differ by ~1e-2 here.
			if ( singular || Math.abs( nx - fx ) > 1e-5 || Math.abs( ny - fy ) > 1e-5 || Math.abs( nz - fz ) > 1e-5 ) curved = true;
			cornerNormals.push( nx, ny, nz );

		}

		// Planar patches are fully described by their hard edges.
		if ( ! curved ) continue;

		for ( let k = 0; k < 3; k ++ ) {

			const v = corners[ 3 * t + k ] * 3;
			triPositions.push( verts[ v ], verts[ v + 1 ], verts[ v + 2 ] );

		}

		triNormals.push( ...cornerNormals );
		triSingular.push( ...cornerSingular );

	}

	return {
		hardSegments,
		contourTriangles: triPositions.length / 9,
		triPositions: Float32Array.from( triPositions ),
		triNormals: Float32Array.from( triNormals ),
		triSingular: Uint8Array.from( triSingular ),
	};

}

/** Upper bound on segments `extractContour` can write, for buffer sizing. */
export const maxContourSegments = edgeData => edgeData.contourTriangles;

/**
 * Fill `out` with the view-dependent contour for an eye position.
 * @returns {number} number of segments written
 */
export function extractContour( edgeData, eyeX, eyeY, eyeZ, out ) {

	const { contourTriangles, triPositions, triNormals, triSingular } = edgeData;
	let written = 0;

	const f = [ 0, 0, 0 ];

	for ( let t = 0; t < contourTriangles; t ++ ) {

		const base = 9 * t;
		let positive = 0;

		for ( let k = 0; k < 3; k ++ ) {

			const p = base + 3 * k;
			// A singular corner is on the silhouette from any viewpoint.
			const value = triSingular[ 3 * t + k ] ? 0 :
				triNormals[ p ] * ( eyeX - triPositions[ p ] ) +
				triNormals[ p + 1 ] * ( eyeY - triPositions[ p + 1 ] ) +
				triNormals[ p + 2 ] * ( eyeZ - triPositions[ p + 2 ] );
			f[ k ] = value;
			if ( value >= 0 ) positive ++;

		}

		if ( positive === 0 || positive === 3 ) continue;

		// Two of the three edges cross zero; interpolate both crossings.
		let slot = 0;
		for ( let k = 0; k < 3 && slot < 2; k ++ ) {

			const j = ( k + 1 ) % 3;
			if ( ( f[ k ] >= 0 ) === ( f[ j ] >= 0 ) ) continue;

			const ratio = f[ k ] / ( f[ k ] - f[ j ] );
			const a = base + 3 * k, b = base + 3 * j;
			const at = 6 * written + 3 * slot;

			out[ at ] = triPositions[ a ] + ( triPositions[ b ] - triPositions[ a ] ) * ratio;
			out[ at + 1 ] = triPositions[ a + 1 ] + ( triPositions[ b + 1 ] - triPositions[ a + 1 ] ) * ratio;
			out[ at + 2 ] = triPositions[ a + 2 ] + ( triPositions[ b + 2 ] - triPositions[ a + 2 ] ) * ratio;
			slot ++;

		}

		if ( slot !== 2 ) continue;

		// Pinning f to zero at singular corners makes every triangle touching
		// one report a crossing; away from the outline those collapse onto the
		// singular point itself and would otherwise render as stray dots.
		const at = 6 * written;
		const dx = out[ at + 3 ] - out[ at ];
		const dy = out[ at + 4 ] - out[ at + 1 ];
		const dz = out[ at + 5 ] - out[ at + 2 ];
		if ( dx * dx + dy * dy + dz * dz > DEGENERATE_SQ ) written ++;

	}

	return written;

}
