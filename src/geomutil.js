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

/**
 * Split T-junctions so the mesh has real edge adjacency.
 *
 * A boolean result is not a manifold mesh. Each source triangle is clipped and
 * re-triangulated on its own, so where a finely cut face meets an untouched
 * one the shared edge is a single long edge on one side and several short ones
 * on the other. Nothing is geometrically wrong — the volume is exact and it
 * renders correctly — but *adjacency* is broken: that long edge belongs to one
 * triangle only.
 *
 * Anything reasoning about edges then falls apart. `buildEdgeData` treats an
 * edge with one face as a shell boundary and draws it, which on a carved solid
 * means a line straight across every flat face, and the creases that should
 * have been found are missed because the two faces never meet along an edge.
 *
 * The repair is to insert the missing vertices: any welded vertex lying on an
 * edge is added to that edge, and the triangle — still convex, since the new
 * points are on its own sides — is re-fanned. Only edges that failed to pair
 * up are examined, which is exactly the set that can carry a T-junction.
 *
 * Corner normals are carried through and interpolated along split edges, so a
 * bored cylinder wall stays smooth and a box corner stays sharp.
 */
export function repairTJunctions( geometry, eps = 1e-5 ) {

	const position = geometry.getAttribute( 'position' );
	const normals = geometry.getAttribute( 'normal' );
	const { verts, ids } = weldPositions( position.array, position.count, eps );
	const indices = triangleIndices( geometry );
	const triangleCount = indices.length / 3;
	const vertexCount = verts.length / 3;

	const use = new Map();
	const bump = ( a, b ) => {

		if ( a === b ) return;
		const key = edgeKey( a, b );
		use.set( key, ( use.get( key ) ?? 0 ) + 1 );

	};

	for ( let t = 0; t < triangleCount; t ++ ) {

		const a = ids[ indices[ 3 * t ] ], b = ids[ indices[ 3 * t + 1 ] ], c = ids[ indices[ 3 * t + 2 ] ];
		bump( a, b ); bump( b, c ); bump( c, a );

	}

	// Vertices in x order, so an edge only has to look at the slab of them
	// its own span covers rather than at all of them.
	const order = new Int32Array( vertexCount );
	for ( let i = 0; i < vertexCount; i ++ ) order[ i ] = i;
	order.sort( ( p, q ) => verts[ 3 * p ] - verts[ 3 * q ] );

	const lowerBound = x => {

		let low = 0, high = vertexCount;
		while ( low < high ) {

			const mid = ( low + high ) >> 1;
			if ( verts[ 3 * order[ mid ] ] < x ) low = mid + 1;
			else high = mid;

		}

		return low;

	};

	/** Welded vertices lying strictly inside the segment a–b, in order. */
	const onSegment = ( a, b ) => {

		const ax = verts[ 3 * a ], ay = verts[ 3 * a + 1 ], az = verts[ 3 * a + 2 ];
		const bx = verts[ 3 * b ], by = verts[ 3 * b + 1 ], bz = verts[ 3 * b + 2 ];
		const dx = bx - ax, dy = by - ay, dz = bz - az;
		const lengthSq = dx * dx + dy * dy + dz * dz;
		if ( lengthSq < eps * eps ) return [];

		const found = [];

		for ( let i = lowerBound( Math.min( ax, bx ) - eps ); i < vertexCount; i ++ ) {

			const v = order[ i ];
			const px = verts[ 3 * v ];
			if ( px > Math.max( ax, bx ) + eps ) break;
			if ( v === a || v === b ) continue;

			const py = verts[ 3 * v + 1 ], pz = verts[ 3 * v + 2 ];
			const t = ( ( px - ax ) * dx + ( py - ay ) * dy + ( pz - az ) * dz ) / lengthSq;
			if ( t <= 0 || t >= 1 ) continue;

			const qx = ax + dx * t - px, qy = ay + dy * t - py, qz = az + dz * t - pz;
			if ( qx * qx + qy * qy + qz * qz > eps * eps ) continue;

			found.push( { v, t } );

		}

		found.sort( ( p, q ) => p.t - q.t );
		return found;

	};

	// Every edge is examined, not just the ones that failed to pair up. An
	// edge can be used twice and still have a vertex sitting on it, put there
	// by a third triangle alongside — and skipping those leaves that third
	// triangle's own edges unmatched, with nothing later able to pair them.
	const splits = new Map();
	for ( const key of use.keys() ) {

		const a = Math.floor( key / 4294967296 );
		const b = key - a * 4294967296;
		const list = onSegment( a, b );
		if ( list.length ) splits.set( key, { a, list } );

	}

	if ( splits.size === 0 ) return null;

	const outPositions = [];
	const outNormals = [];
	const corner = [ 0, 0, 0 ];
	const cornerNormal = [ null, null, null ];

	for ( let t = 0; t < triangleCount; t ++ ) {

		for ( let k = 0; k < 3; k ++ ) {

			const source = indices[ 3 * t + k ];
			corner[ k ] = ids[ source ];
			cornerNormal[ k ] = normals
				? [ normals.getX( source ), normals.getY( source ), normals.getZ( source ) ]
				: null;

		}

		const polygon = [];

		for ( let k = 0; k < 3; k ++ ) {

			const from = corner[ k ], to = corner[ ( k + 1 ) % 3 ];
			const fromNormal = cornerNormal[ k ], toNormal = cornerNormal[ ( k + 1 ) % 3 ];
			polygon.push( { v: from, n: fromNormal } );

			const split = splits.get( edgeKey( from, to ) );
			if ( ! split ) continue;

			// The stored order runs from the edge's own first vertex; flip it
			// when this triangle walks the edge the other way.
			const list = split.a === from ? split.list : [ ...split.list ].reverse();

			for ( const { v, t: along } of list ) {

				const ratio = split.a === from ? along : 1 - along;
				polygon.push( {
					v,
					n: fromNormal && toNormal
						? [
							fromNormal[ 0 ] + ( toNormal[ 0 ] - fromNormal[ 0 ] ) * ratio,
							fromNormal[ 1 ] + ( toNormal[ 1 ] - fromNormal[ 1 ] ) * ratio,
							fromNormal[ 2 ] + ( toNormal[ 2 ] - fromNormal[ 2 ] ) * ratio,
						]
						: null,
				} );

			}

		}

		const emit = point => {

			if ( point.p ) outPositions.push( point.p[ 0 ], point.p[ 1 ], point.p[ 2 ] );
			else outPositions.push( verts[ 3 * point.v ], verts[ 3 * point.v + 1 ], verts[ 3 * point.v + 2 ] );

			if ( ! point.n ) return;
			const length = Math.hypot( point.n[ 0 ], point.n[ 1 ], point.n[ 2 ] ) || 1;
			outNormals.push( point.n[ 0 ] / length, point.n[ 1 ] / length, point.n[ 2 ] / length );

		};

		if ( polygon.length === 3 ) {

			for ( const point of polygon ) emit( point );
			continue;

		}

		// Fanning from a corner would put the split points of the edges that
		// meet at it in a straight line with it, and those triangles come out
		// with no area at all. Their normals are then pure noise, which reads
		// as a crease against every neighbour — a line drawn across the middle
		// of a flat face. Fanning from a point inside the triangle instead
		// keeps every piece of it a real triangle. The new point is interior,
		// so no neighbour's adjacency is disturbed.
		const centre = { p: [ 0, 0, 0 ], n: polygon[ 0 ].n ? [ 0, 0, 0 ] : null };

		for ( const point of polygon ) {

			centre.p[ 0 ] += verts[ 3 * point.v ] / polygon.length;
			centre.p[ 1 ] += verts[ 3 * point.v + 1 ] / polygon.length;
			centre.p[ 2 ] += verts[ 3 * point.v + 2 ] / polygon.length;
			if ( centre.n ) for ( let k = 0; k < 3; k ++ ) centre.n[ k ] += point.n[ k ] / polygon.length;

		}

		for ( let i = 0; i < polygon.length; i ++ ) {

			emit( centre );
			emit( polygon[ i ] );
			emit( polygon[ ( i + 1 ) % polygon.length ] );

		}

	}

	return {
		position: Float32Array.from( outPositions ),
		normal: outNormals.length === outPositions.length ? Float32Array.from( outNormals ) : null,
	};

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
