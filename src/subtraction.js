// Form subtraction: one solid, carved by others.
//
// The exercise is to draw a form you have never seen before, which means the
// form has to be new every time. So nothing here picks from a list of five
// shapes: the solid being carved is built from a 2D profile drawn at random —
// straight runs and arcs, or a skyline of columns — and extruded to give it
// its third dimension.
//
// The cuts are the opposite: they stay a small vocabulary of recognisable
// tools — a slot and a wedge — because a cut has to read *as a cut*. A hole
// left by an arbitrary carved shape reads as damage, and there is nothing to
// learn from drawing it.
//
// Two rules govern every cut, and both are checked against the real boolean
// rather than assumed:
//
//   1. **A cut must take a worthwhile bite and no more.** Too little and
//      there is nothing to draw; too much and the form is gone. The volume
//      actually removed is measured and the cut is rejected on either side.
//
//   2. **The form stays in one piece.** A cut that saws the solid in two
//      leaves two forms, not a carved one, so the result's connected
//      components are counted and the cut is rejected if it split anything.
//
// How deep a cut goes is measured, not guessed: a ray is fired from the entry
// point into the solid and the far wall it comes out of gives the thickness
// there, so a cut can be driven exactly through without knowing anything
// about the form's shape.

import {
	BoxGeometry, BufferAttribute, BufferGeometry, ExtrudeGeometry, Matrix4,
	Quaternion, Shape, Vector2, Vector3,
} from 'three';
import { chainSegments, repairTJunctions, triangleIndices, weldPositions } from './geomutil.js';
import { makeBrush, meshVolume, subtract } from './intersections.js';
import { buildSurfaceSampler } from './placement.js';
import { buildEdgeData } from './silhouette.js';

/** What the construction guides show. The shared toggle still turns them off. */
export const GUIDES = [
	{ id: 'solid', label: 'Solid' },
	{ id: 'cuts', label: 'Solid + cuts' },
];

/**
 * One setting, not three. The exercise is a form you have not seen before and
 * a couple of cuts through it; levels of it were tried and taken back out.
 */
const CONFIG = {
	cuts: [ 1, 2 ],
	tools: [ 'slot', 'wedge' ],
	tilt: 10,
	bite: [ 0.07, 0.36 ],
	budget: 0.5,
};

// The carved form is sized to sit in the same space as the other exercises'.
const TARGET_RADIUS = 1.7;

const DEG = Math.PI / 180;
const ATTEMPTS_PER_CUT = 14;

const range = ( rng, min, max ) => min + rng() * ( max - min );
const randInt = ( rng, min, max ) => min + Math.floor( rng() * ( max - min + 1 ) );
const pick = ( rng, list ) => list[ Math.floor( rng() * list.length ) ];

// --- profiles ---------------------------------------------------------------

/**
 * A closed outline of straight runs and arcs. The corners are drawn at sorted
 * angles around the centre, which makes the outline star-shaped and therefore
 * simple — a profile that crosses itself extrudes into a solid no boolean can
 * make sense of, and rejecting those after the fact is far more work than not
 * drawing them.
 */
function roundedProfile( rng ) {

	const corners = randInt( rng, 3, 6 );
	const shape = new Shape();
	const points = [];

	for ( let i = 0; i < corners; i ++ ) {

		const angle = ( i + range( rng, - 0.18, 0.18 ) ) / corners * Math.PI * 2;
		const radius = range( rng, 0.55, 1 );
		points.push( new Vector2( Math.cos( angle ) * radius, Math.sin( angle ) * radius ) );

	}

	shape.moveTo( points[ 0 ].x, points[ 0 ].y );

	for ( let i = 0; i < corners; i ++ ) {

		const from = points[ i ];
		const to = points[ ( i + 1 ) % corners ];

		if ( rng() < 0.45 ) {

			// A bulged side. The control point is the chord's midpoint pushed
			// out or pulled in; kept close to 1 so the curve cannot swing back
			// across a neighbouring side.
			const bulge = range( rng, 0.86, 1.34 );
			shape.quadraticCurveTo(
				( from.x + to.x ) / 2 * bulge, ( from.y + to.y ) / 2 * bulge,
				to.x, to.y,
			);

		} else {

			shape.lineTo( to.x, to.y );

		}

	}

	shape.closePath();
	return shape;

}

/**
 * A skyline: a flat base, a run of columns of differing heights, and back down
 * the other side. Always simple by construction, and it is where the L-shapes
 * and stepped blocks in the reference sheets come from.
 */
function skylineProfile( rng ) {

	const columns = randInt( rng, 2, 4 );
	const widths = [];
	const heights = [];
	let width = 0;

	for ( let i = 0; i < columns; i ++ ) {

		widths.push( range( rng, 0.45, 1.1 ) );
		heights.push( range( rng, 0.5, 1.6 ) );
		width += widths[ i ];

	}

	const shape = new Shape();
	shape.moveTo( - width / 2, 0 );

	let x = - width / 2;
	for ( let i = 0; i < columns; i ++ ) {

		shape.lineTo( x, heights[ i ] );
		x += widths[ i ];
		shape.lineTo( x, heights[ i ] );

	}

	shape.lineTo( x, 0 );
	shape.closePath();
	return shape;

}

// --- base solids ------------------------------------------------------------

function extrudedBase( rng ) {

	const shape = rng() < 0.5 ? roundedProfile( rng ) : skylineProfile( rng );
	const depth = range( rng, 0.8, 2.2 );
	const geometry = new ExtrudeGeometry( shape, { depth, bevelEnabled: false, curveSegments: 20 } );
	geometry.translate( 0, 0, - depth / 2 );
	return geometry;

}

/** Centre a geometry on its bounds and scale it to a comparable size. */
function normalise( geometry ) {

	geometry.computeBoundingBox();
	const centre = geometry.boundingBox.getCenter( new Vector3() );
	geometry.translate( - centre.x, - centre.y, - centre.z );

	geometry.computeBoundingSphere();
	const radius = geometry.boundingSphere.radius;
	if ( radius > 1e-6 ) geometry.scale( TARGET_RADIUS / radius, TARGET_RADIUS / radius, TARGET_RADIUS / radius );

	geometry.computeBoundingSphere();
	return geometry;

}

// --- tools ------------------------------------------------------------------
//
// Every tool is built centred on the origin. `axis` is the local direction
// that gets aimed into the form, and `reach` is how far the tool sticks out
// from its centre along that direction — which is what turns "cut this deep"
// into a position.

const Y = new Vector3( 0, 1, 0 );
const Z = new Vector3( 0, 0, 1 );

function slotTool( rng, thickness, length ) {

	const width = thickness * range( rng, 0.8, 2.6 );
	const geometry = new BoxGeometry( width, length, thickness );
	return { geometry, axis: Y.clone(), reach: length / 2 };

}

function wedgeTool( rng, thickness, length ) {

	// A triangular prism: the angled cut, and the only tool that leaves a
	// wall that is neither square to the form nor round.
	const half = thickness * range( rng, 0.7, 1.8 );
	const shape = new Shape();
	shape.moveTo( - half, - length / 2 );
	shape.lineTo( half, - length / 2 );
	shape.lineTo( range( rng, - half, half ), length / 2 );
	shape.closePath();

	const depth = thickness * range( rng, 1.6, 3.4 );
	const geometry = new ExtrudeGeometry( shape, { depth, bevelEnabled: false, curveSegments: 1 } );
	geometry.translate( 0, 0, - depth / 2 );
	return { geometry, axis: Y.clone(), reach: length / 2 };

}

const TOOLS = { slot: slotTool, wedge: wedgeTool };

// --- measuring the solid ----------------------------------------------------

/**
 * How far a ray fired into the form travels before leaving it for the last
 * time. This is what makes "straight through" and "stops inside" exact on a
 * form whose shape nobody knows in advance.
 */
function farthestExit( geometry, origin, direction ) {

	const position = geometry.getAttribute( 'position' ).array;
	const indices = triangleIndices( geometry );

	const edge1 = new Vector3(), edge2 = new Vector3();
	const h = new Vector3(), s = new Vector3(), q = new Vector3();
	const a = new Vector3(), b = new Vector3(), c = new Vector3();
	let far = 0;

	for ( let t = 0; t < indices.length; t += 3 ) {

		a.fromArray( position, 3 * indices[ t ] );
		b.fromArray( position, 3 * indices[ t + 1 ] );
		c.fromArray( position, 3 * indices[ t + 2 ] );

		edge1.subVectors( b, a );
		edge2.subVectors( c, a );
		h.crossVectors( direction, edge2 );
		const determinant = edge1.dot( h );
		if ( Math.abs( determinant ) < 1e-12 ) continue;

		const inverse = 1 / determinant;
		s.subVectors( origin, a );
		const u = inverse * s.dot( h );
		if ( u < 0 || u > 1 ) continue;

		q.crossVectors( s, edge1 );
		const v = inverse * direction.dot( q );
		if ( v < 0 || u + v > 1 ) continue;

		const distance = inverse * edge2.dot( q );
		if ( distance > far ) far = distance;

	}

	return far;

}

/**
 * How many separate solids a geometry describes. A cut that saws the form in
 * two passes every volume check there is — the halves are still there — so
 * this is the only thing standing between the exercise and two forms lying
 * next to each other.
 */
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

// --- ghost lines ------------------------------------------------------------

/**
 * A solid's hard edges, chained into polylines rather than left as loose
 * segments — an arc in the profile is one line to draw, not twenty.
 */
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

/** Lines for a ghosted tool, in the place it cut. */
function toolGhost( tool, matrix ) {

	return wireframe( tool.geometry ).map( points => transformPolyline( points, matrix ) );

}

// --- carving ----------------------------------------------------------------

/**
 * Place one tool against the form and return the carved result, or null if
 * this attempt was not worth keeping.
 */
function attemptCut( rng, cfg, geometry, sampler, volume, size ) {

	const point = new Vector3();
	const normal = new Vector3();
	sampler( rng, point, normal );

	// Aim into the form, tilted off the surface normal so cuts are not all
	// square to the face they enter.
	const aim = normal.clone().negate().normalize();
	const sideways = new Vector3().crossVectors( aim, Math.abs( aim.y ) > 0.9 ? Z : Y ).normalize();
	aim.applyAxisAngle( sideways, range( rng, - cfg.tilt, cfg.tilt ) * DEG )
		.applyAxisAngle( normal, rng() * Math.PI * 2 ).normalize();

	const thickness = farthestExit( geometry, point.clone().addScaledVector( aim, 1e-4 ), aim );
	if ( thickness < size * 0.05 ) return null;

	// Every cut is driven straight through: deep enough to come out of the
	// far wall the ray found, and long enough to still stick out of the face
	// it went in by.
	const kind = pick( rng, cfg.tools );
	const depth = thickness + size * 0.25;
	const length = depth + size * 0.5;

	const tool = TOOLS[ kind ]( rng, size * range( rng, 0.16, 0.42 ), length );

	// Aim the tool's own axis down the line of the cut, then spin it about
	// that line so a slot is not always square to the world.
	const orientation = new Quaternion()
		.setFromAxisAngle( aim, rng() * Math.PI * 2 )
		.multiply( new Quaternion().setFromUnitVectors( tool.axis, aim ) );

	// The tool reaches `reach` beyond its own centre, so putting its deepest
	// point at `depth` below the entry fixes the centre exactly.
	const position = point.clone().addScaledVector( aim, depth - tool.reach );

	const matrix = new Matrix4().compose( position, orientation, new Vector3( 1, 1, 1 ) );
	const placed = tool.geometry.clone().applyMatrix4( matrix );

	const carved = subtract( makeBrush( geometry ), makeBrush( placed ) );
	if ( ! carved ) {

		placed.dispose();
		tool.geometry.dispose();
		return null;

	}

	const bite = ( volume - meshVolume( carved ) ) / volume;

	if ( bite < cfg.bite[ 0 ] || bite > cfg.bite[ 1 ] || componentCount( carved ) !== 1 ) {

		carved.dispose();
		placed.dispose();
		tool.geometry.dispose();
		return null;

	}

	const ghost = toolGhost( tool, matrix );
	placed.dispose();
	tool.geometry.dispose();

	return { geometry: carved, bite, ghost, kind };

}

/**
 * Give the carved result real edge adjacency. The booleans leave T-junctions
 * where a re-triangulated face meets an untouched one, and every line the
 * drawing is made of comes from edge adjacency — so this runs once at the
 * end, on the geometry that will actually be drawn, rather than on every
 * intermediate the solver throws away.
 */
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

/**
 * @returns {{ geometry, cuts: number, removed: number,
 *   ghost: { solid: Float32Array[], cuts: Float32Array[] } }}
 *   `geometry` is world-baked and ready for `FormScene.createForm()`.
 */
export function generateSubtraction( rng = Math.random ) {

	const cfg = CONFIG;
	const base = normalise( extrudedBase( rng ) );
	const size = base.boundingSphere.radius;
	const solidGhost = wireframe( base );

	let geometry = base;
	let volume = meshVolume( base );
	const startVolume = volume;
	const wanted = randInt( rng, cfg.cuts[ 0 ], cfg.cuts[ 1 ] );
	const cutGhosts = [];
	let made = 0;

	for ( let i = 0; i < wanted; i ++ ) {

		// Sampling the surface *as it now is* is what makes later cuts run
		// into earlier ones: once a pocket is open, its walls are as likely a
		// place to start from as the original outside of the form.
		const sampler = buildSurfaceSampler( geometry );
		let cut = null;

		for ( let attempt = 0; attempt < ATTEMPTS_PER_CUT && ! cut; attempt ++ ) {

			cut = attemptCut( rng, cfg, geometry, sampler, volume, size );

		}

		if ( ! cut ) continue;

		const after = meshVolume( cut.geometry );
		if ( 1 - after / startVolume > cfg.budget ) {

			cut.geometry.dispose();
			continue;

		}

		if ( geometry !== base ) geometry.dispose();
		geometry = cut.geometry;
		volume = after;
		cutGhosts.push( ...cut.ghost );
		made ++;

	}

	if ( geometry !== base ) base.dispose();

	return {
		geometry: manifold( geometry ),
		cuts: made,
		removed: 1 - volume / startVolume,
		ghost: { solid: solidGhost, cuts: cutGhosts },
	};

}
