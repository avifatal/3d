// The five forms, plus the construction lines an artist would block in before
// drawing them. Geometry is always built centred on the origin; placement
// bakes the transform in afterwards.
//
// Tessellation is chosen for curve quality rather than for shading. A sphere
// is an icosphere (no pole pinch, even triangles) at a density that keeps both
// its contour and any intersection curve within a few tenths of a percent of
// the true surface.

import { BoxGeometry, ConeGeometry, IcosahedronGeometry, Vector3 } from 'three';

export const SHAPES = [
	{ id: 'box', label: 'Box' },
	{ id: 'boxProportions', label: 'Box — variable proportions' },
	{ id: 'sphere', label: 'Sphere' },
	{ id: 'cone', label: 'Cone' },
	{ id: 'pyramid', label: 'Pyramid' },
];

const SPHERE_DETAIL = 7;   // 1280 triangles
const CONE_SEGMENTS = 72;

const range = ( rng, min, max ) => min + rng() * ( max - min );

/** Circle of radius r on the plane spanned by axes u and v, centred at c. */
function circle( centre, u, v, radius, segments = 96 ) {

	const points = new Float32Array( ( segments + 1 ) * 3 );

	for ( let i = 0; i <= segments; i ++ ) {

		const angle = i / segments * Math.PI * 2;
		const x = Math.cos( angle ) * radius, y = Math.sin( angle ) * radius;
		points[ 3 * i ] = centre.x + u.x * x + v.x * y;
		points[ 3 * i + 1 ] = centre.y + u.y * x + v.y * y;
		points[ 3 * i + 2 ] = centre.z + u.z * x + v.z * y;

	}

	return points;

}

const segment = ( a, b ) => Float32Array.from( [ a.x, a.y, a.z, b.x, b.y, b.z ] );

const X = new Vector3( 1, 0, 0 );
const Y = new Vector3( 0, 1, 0 );
const Z = new Vector3( 0, 0, 1 );

function axisCross( half ) {

	return [
		segment( new Vector3( - half.x, 0, 0 ), new Vector3( half.x, 0, 0 ) ),
		segment( new Vector3( 0, - half.y, 0 ), new Vector3( 0, half.y, 0 ) ),
		segment( new Vector3( 0, 0, - half.z ), new Vector3( 0, 0, half.z ) ),
	];

}

/**
 * @returns {{ geometry, construction: Float32Array[], radius: number }}
 *   `construction` holds local-space polylines drawn only when the user asks
 *   for construction guides.
 */
export function createShape( shapeId, rng ) {

	let geometry;
	let construction;

	switch ( shapeId ) {

		case 'box': {

			const size = range( rng, 1.0, 1.7 );
			geometry = new BoxGeometry( size, size, size );
			construction = axisCross( new Vector3( size / 2, size / 2, size / 2 ) );
			break;

		}

		case 'boxProportions': {

			// Re-roll until the slab is clearly non-cubic but not a sliver.
			let w, h, d;
			do {

				w = range( rng, 0.55, 2.2 );
				h = range( rng, 0.55, 2.2 );
				d = range( rng, 0.55, 2.2 );

			} while ( Math.max( w, h, d ) / Math.min( w, h, d ) < 1.6 || Math.max( w, h, d ) / Math.min( w, h, d ) > 4 );

			geometry = new BoxGeometry( w, h, d );
			construction = axisCross( new Vector3( w / 2, h / 2, d / 2 ) );
			break;

		}

		case 'sphere': {

			const radius = range( rng, 0.65, 1.15 );
			geometry = new IcosahedronGeometry( radius, SPHERE_DETAIL );
			// The three great circles you would block in to sit a sphere in space.
			construction = [
				circle( new Vector3(), X, Z, radius ),
				circle( new Vector3(), X, Y, radius ),
				circle( new Vector3(), Y, Z, radius ),
			];
			break;

		}

		case 'cone': {

			const radius = range( rng, 0.55, 0.95 );
			const height = range( rng, 1.5, 2.6 );
			geometry = new ConeGeometry( radius, height, CONE_SEGMENTS );
			construction = [
				segment( new Vector3( 0, height / 2, 0 ), new Vector3( 0, - height / 2, 0 ) ),
				circle( new Vector3( 0, - height / 2, 0 ), X, Z, radius ),
				segment( new Vector3( - radius, - height / 2, 0 ), new Vector3( radius, - height / 2, 0 ) ),
				segment( new Vector3( 0, - height / 2, - radius ), new Vector3( 0, - height / 2, radius ) ),
			];
			break;

		}

		case 'pyramid': {

			const radius = range( rng, 0.8, 1.25 );
			const height = range( rng, 1.3, 2.3 );
			geometry = new ConeGeometry( radius, height, 4 );
			geometry.rotateY( Math.PI / 4 );
			const half = radius / Math.SQRT2;
			construction = [
				segment( new Vector3( 0, height / 2, 0 ), new Vector3( 0, - height / 2, 0 ) ),
				segment( new Vector3( - half, - height / 2, - half ), new Vector3( half, - height / 2, half ) ),
				segment( new Vector3( - half, - height / 2, half ), new Vector3( half, - height / 2, - half ) ),
			];
			break;

		}

		default:
			throw new Error( `unknown shape "${shapeId}"` );

	}

	geometry.computeBoundingSphere();

	return { geometry, construction, radius: geometry.boundingSphere.radius };

}
