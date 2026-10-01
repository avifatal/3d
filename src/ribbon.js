// Carry a varied planar curve across a constant width, keeping the two
// long edges parallel in space before rotating the whole strip.
import { BufferGeometry, Euler, Float32BufferAttribute, Matrix4, Vector3 } from 'three';

export const LEVELS = [
	{ id: 'easier', note: 'One broad bend. Follow the matching edges and connect their ends.', bends: 1 },
	{ id: 'harder', note: 'Large and small bends form an uneven S-curve at varied angles. Follow each edge through the turns.', bends: 2 },
	{ id: 'hardest', note: 'Several bends of different heights and spans at stronger angles. Study overlaps and foreshortening.', bends: 3 },
];

export function generateRibbon( levelId = 'easier', rng = Math.random ) {

	const level = LEVELS.find( entry => entry.id === levelId );
	if ( ! level ) throw new Error( `Unknown ribbon level: ${levelId}` );
	const random = ( a, b ) => a + ( b - a ) * rng();
	const bends = level.bends;
	const length = random( 3.8, 5.0 ) + ( bends - 1 ) * 1.2;
	const width = random( 0.9, 1.9 );
	const amplitude = bends === 1 ? random( 0.55, 1.15 ) : random( 0.85, 1.35 );
	const direction = rng() < 0.5 ? -1 : 1;
	// Give each bend its own height and span. Separate shuffled size bands
	// guarantee visible contrast instead of occasionally drawing equal waves.
	const variedSizes = () => {

		const sizes = bends === 1 ? [ 1 ] : bends === 2
			? [ random( 0.45, 0.65 ), random( 1.2, 1.6 ) ]
			: [ random( 0.45, 0.65 ), random( 0.8, 1.0 ), random( 1.2, 1.6 ) ];
		for ( let i = sizes.length - 1; i > 0; i -- ) {

			const j = Math.floor( rng() * ( i + 1 ) );
			[ sizes[ i ], sizes[ j ] ] = [ sizes[ j ], sizes[ i ] ];

		}
		return sizes;

	};
	const heights = variedSizes();
	const spans = variedSizes();
	const totalSpan = spans.reduce( ( sum, span ) => sum + span, 0 );
	const knots = [ { t: 0, y: 0 } ];
	let offset = 0;
	for ( let i = 0; i < bends; i ++ ) {

		knots.push( {
			t: ( offset + spans[ i ] / 2 ) / totalSpan,
			y: direction * ( i % 2 ? -1 : 1 ) * amplitude * heights[ i ],
		} );
		offset += spans[ i ];

	}
	knots.push( { t: 1, y: 0 } );
	const samplesPerBend = 384;
	const segments = bends * samplesPerBend;
	const acrossSegments = 1;
	// Tilt and roll the whole strip, including upright and diagonal placements.
	const tilt = bends === 1 ? 0.3 : bends === 2 ? 0.75 : 1.1;
	const rotation = new Matrix4().makeRotationFromEuler( new Euler(
		random( -tilt, tilt ),
		random( -Math.PI, Math.PI ),
		random( -tilt, tilt ) + ( bends > 1 && rng() < 0.3 ? Math.PI / 2 : 0 ),
	) );
	const positions = [], indices = [], construction = [];
	const point = new Vector3();
	const profile = t => {

		const next = knots.findIndex( knot => knot.t >= t );
		if ( next === 0 ) return knots[ 0 ].y;
		const a = knots[ next - 1 ], b = knots[ next ];
		const u = ( t - a.t ) / ( b.t - a.t );
		// Zero slope at each crest joins unequal bends without a corner.
		return a.y + ( b.y - a.y ) * ( 1 - Math.cos( Math.PI * u ) ) / 2;

	};
	for ( let i = 0; i <= segments; i ++ ) {

		const t = i / segments;
		const y = profile( t );
		const start = positions.length;
		for ( let j = 0; j <= acrossSegments; j ++ ) {

			point.set( ( t - 0.5 ) * length, y, ( j / acrossSegments - 0.5 ) * width ).applyMatrix4( rotation );
			positions.push( point.x, point.y, point.z );
			if ( i < segments && j < acrossSegments ) {

				const a = i * ( acrossSegments + 1 ) + j;
				const b = a + acrossSegments + 1;
				indices.push( a, a + 1, b, a + 1, b + 1, b );

			}

		}
		// Sparse cross-sections describe the surface without a wireframe mesh.
		if ( i > 0 && i < segments && i % ( samplesPerBend / 4 ) === 0 ) {

			construction.push( Float32Array.from( [ ...positions.slice( start, start + 3 ), ...positions.slice( -3 ) ] ) );

		}

	}
	const geometry = new BufferGeometry();
	geometry.setAttribute( 'position', new Float32BufferAttribute( positions, 3 ) );
	geometry.setIndex( indices );
	geometry.computeVertexNormals();
	geometry.computeBoundingSphere();
	return { geometry, construction, bends, width, segments, acrossSegments };

}
