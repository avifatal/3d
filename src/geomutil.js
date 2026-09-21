// Low-level geometry helpers shared by the seam extractor and the silhouette
// builder. Everything here works on plain typed arrays so it can run outside a
// WebGL context (the node tests import these directly).

/**
 * Collapse coincident vertices. CSG output and three's cone/sphere primitives
 * both duplicate vertices that are geometrically identical, which breaks any
 * edge-adjacency reasoning. Neighbouring grid cells are searched too so that
 * two points straddling a cell boundary still weld.
 */
export function weldPositions( positions, vertexCount, eps = 1e-5 ) {

	const inv = 1 / eps;
	const cells = new Map();
	const verts = [];
	const ids = new Int32Array( vertexCount );

	for ( let i = 0; i < vertexCount; i ++ ) {

		const x = positions[ 3 * i ], y = positions[ 3 * i + 1 ], z = positions[ 3 * i + 2 ];
		const gx = Math.floor( x * inv ), gy = Math.floor( y * inv ), gz = Math.floor( z * inv );

		let found = - 1;
		for ( let dx = - 1; dx <= 1 && found < 0; dx ++ ) {

			for ( let dy = - 1; dy <= 1 && found < 0; dy ++ ) {

				for ( let dz = - 1; dz <= 1 && found < 0; dz ++ ) {

					const bucket = cells.get( `${gx + dx},${gy + dy},${gz + dz}` );
					if ( ! bucket ) continue;

					for ( let b = 0; b < bucket.length; b ++ ) {

						const vi = bucket[ b ];
						if (
							Math.abs( verts[ 3 * vi ] - x ) <= eps &&
							Math.abs( verts[ 3 * vi + 1 ] - y ) <= eps &&
							Math.abs( verts[ 3 * vi + 2 ] - z ) <= eps
						) {

							found = vi;
							break;

						}

					}

				}

			}

		}

		if ( found < 0 ) {

			found = verts.length / 3;
			verts.push( x, y, z );
			const key = `${gx},${gy},${gz}`;
			let bucket = cells.get( key );
			if ( ! bucket ) cells.set( key, bucket = [] );
			bucket.push( found );

		}

		ids[ i ] = found;

	}

	return { verts: Float64Array.from( verts ), ids };

}

/** Triangle indices of a geometry as a flat Int32Array, indexed or not. */
export function triangleIndices( geometry ) {

	const index = geometry.getIndex();
	if ( index ) return Int32Array.from( index.array );

	const count = geometry.getAttribute( 'position' ).count;
	const out = new Int32Array( count );
	for ( let i = 0; i < count; i ++ ) out[ i ] = i;
	return out;

}

const edgeKey = ( a, b ) => ( a < b ? a * 4294967296 + b : b * 4294967296 + a );

/**
 * Walk a bag of undirected segments into ordered polylines.
 *
 * CSG output is not a clean set of disjoint loops: coincident-face cases leave
 * T-junctions and stray micro-fragments, so vertices with three or more
 * incident segments are common. At such a junction we continue along whichever
 * segment best preserves the current direction, which keeps the real curve
 * intact and spits the noise out as separate short chains the caller can drop.
 */
export function chainSegments( segments, verts ) {

	const adjacency = new Map();
	const add = ( a, b ) => {

		let list = adjacency.get( a );
		if ( ! list ) adjacency.set( a, list = [] );
		list.push( b );

	};

	for ( const [ a, b ] of segments ) {

		add( a, b );
		add( b, a );

	}

	const direction = ( from, to, out ) => {

		out[ 0 ] = verts[ 3 * to ] - verts[ 3 * from ];
		out[ 1 ] = verts[ 3 * to + 1 ] - verts[ 3 * from + 1 ];
		out[ 2 ] = verts[ 3 * to + 2 ] - verts[ 3 * from + 2 ];
		const length = Math.hypot( out[ 0 ], out[ 1 ], out[ 2 ] ) || 1;
		out[ 0 ] /= length;
		out[ 1 ] /= length;
		out[ 2 ] /= length;

	};

	const used = new Set();
	const polylines = [];
	const incoming = [ 0, 0, 0 ];
	const candidate = [ 0, 0, 0 ];

	const walk = start => {

		const chain = [ start ];
		let current = start;
		let hasDirection = false;

		for ( ;; ) {

			const neighbours = adjacency.get( current );
			if ( ! neighbours ) break;

			let next = - 1;
			let bestScore = - Infinity;

			for ( const option of neighbours ) {

				if ( option === current ) continue;
				if ( used.has( edgeKey( current, option ) ) ) continue;

				let score = 1;
				if ( hasDirection ) {

					direction( current, option, candidate );
					score = incoming[ 0 ] * candidate[ 0 ] + incoming[ 1 ] * candidate[ 1 ] + incoming[ 2 ] * candidate[ 2 ];

				}

				if ( score > bestScore ) {

					bestScore = score;
					next = option;

				}

			}

			if ( next < 0 ) break;

			used.add( edgeKey( current, next ) );
			direction( current, next, incoming );
			hasDirection = true;
			chain.push( next );
			current = next;

			if ( current === start ) break;

		}

		if ( chain.length > 1 ) polylines.push( chain );

	};

	// Endpoints first, so a dangling stub is not swallowed mid-loop.
	for ( const [ vertex, neighbours ] of adjacency ) {

		if ( neighbours.length === 1 ) walk( vertex );

	}

	for ( const [ vertex, neighbours ] of adjacency ) {

		for ( const option of neighbours ) {

			if ( ! used.has( edgeKey( vertex, option ) ) ) {

				walk( vertex );
				break;

			}

		}

	}

	return polylines;

}

export { edgeKey };
