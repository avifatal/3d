// Box stacking: arrangements of boxes resting on one another.
//
// The generator never places a box by eye. Every box is rested on a *support
// plane* — the top face of the box below, or the ground — and its centre is
// solved from that plane so the contact is exact: no gap to fall through, no
// interpenetration, and the centre of mass stays over the support so the
// stack looks like it could actually stand.
//
// Working in the support's own frame is what makes the levels fall out
// naturally. A yaw of zero means "parallel to the box below", so the easier
// level keeps a whole tower square simply by not turning anything, while the
// harder levels turn each box freely against the one beneath it.
//
// A box is only ever one of two things, and nothing here may produce a third:
// it sits flat on what is below it, or it leans against a neighbour. Tilting
// a box away from the face it rests on collapses the contact to a single
// edge, which has no area for the centre of mass to sit over, so such a box
// could only ever topple. Every tilted box therefore has to earn a second
// contact against another box before it is allowed into the scene.
//
// And no two boxes ever share space. Contacts are solved to touch exactly —
// from the clear side, so rounding can only ever leave a hair of daylight,
// never an overlap. Boxes are solid; a stack of them has no intersections to
// draw, which is what separates this exercise from the other one.

import { Matrix4, Quaternion, Vector3 } from 'three';

export const LEVELS = [
	{
		id: 'easier',
		label: 'Easier',
		note: 'One tower, every box parallel to the one below and squarely on it.',
	},
	{
		id: 'harder',
		label: 'Harder',
		note: 'One tower, each box turned freely against the one below, sometimes with a box propped against it.',
	},
	{
		id: 'hardest',
		label: 'Hardest',
		note: 'A shared scene: several towers, loose boxes on the ground, and boxes leaning against a stack.',
	},
];

const CONFIG = {
	easier: {
		perTower: [ 2, 4 ],
		parallel: true,
		leaners: [ 0, 0 ],
		offset: 0.22,
		footprint: [ 1.3, 2.4 ],
		height: [ 0.45, 1.0 ],
		shrink: [ 0.68, 0.9 ],
	},
	harder: {
		perTower: [ 4, 6 ],
		parallel: false,
		leaners: [ 0, 1 ],
		offset: 0.55,
		footprint: [ 1.0, 2.2 ],
		height: [ 0.4, 1.25 ],
		shrink: [ 0.66, 0.96 ],
	},
	hardest: {
		total: [ 10, 16 ],
		towers: [ 3, 4 ],
		perTower: [ 2, 5 ],
		groundBoxes: [ 1, 3 ],
		leaners: [ 1, 2 ],
		parallel: false,
		offset: 0.5,
		// Smaller bases than the single-tower levels so several towers can
		// stand close enough together to read as one arrangement.
		footprint: [ 0.7, 1.6 ],
		height: [ 0.4, 1.15 ],
		shrink: [ 0.66, 0.96 ],
		spread: 3.2,
	},
};

const GROUND = 0;
const DEG = Math.PI / 180;

const CONTACT_TOLERANCE = 1e-9;

const range = ( rng, min, max ) => min + rng() * ( max - min );
const randInt = ( rng, min, max ) => min + Math.floor( rng() * ( max - min + 1 ) );
const clamp = ( value, min, max ) => Math.min( Math.max( value, min ), max );

/**
 * How far a rotated box reaches from its centre along `axis`. This is the
 * support function of the box, and it is what turns "rest on this plane" into
 * a single exact offset along the plane normal.
 */
export function extentAlong( quaternion, half, axis ) {
	const e = new Matrix4().makeRotationFromQuaternion( quaternion ).elements;
	const x = axis.x * e[ 0 ] + axis.y * e[ 1 ] + axis.z * e[ 2 ];
	const y = axis.x * e[ 4 ] + axis.y * e[ 5 ] + axis.z * e[ 6 ];
	const z = axis.x * e[ 8 ] + axis.y * e[ 9 ] + axis.z * e[ 10 ];
	return Math.abs( x ) * half.x + Math.abs( y ) * half.y + Math.abs( z ) * half.z;
}

const _axesA = [ new Vector3(), new Vector3(), new Vector3() ];
const _axesB = [ new Vector3(), new Vector3(), new Vector3() ];
const _delta = new Vector3();
const _cross = new Vector3();
const _matrix = new Matrix4();
const _push = new Vector3();

function readAxes( box, into ) {
	const e = _matrix.makeRotationFromQuaternion( box.quaternion ).elements;
	into[ 0 ].set( e[ 0 ], e[ 1 ], e[ 2 ] );
	into[ 1 ].set( e[ 4 ], e[ 5 ], e[ 6 ] );
	into[ 2 ].set( e[ 8 ], e[ 9 ], e[ 10 ] );
	return into;
}

/**
 * Separating-axis distance between two oriented boxes: positive when they are
 * apart by that much, zero when they touch exactly, negative when they
 * interpenetrate by that much. Pass `outAxis` to also receive that axis,
 * oriented from `a` towards `b` — the direction `a` can push `b`.
 */
export function obbSeparation( a, b, outAxis = null ) {
	const A = readAxes( a, _axesA );
	const B = readAxes( b, _axesB );
	_delta.subVectors( b.position, a.position );

	const project = ( axes, size, axis ) =>
		Math.abs( axes[ 0 ].dot( axis ) ) * size.x * 0.5 +
		Math.abs( axes[ 1 ].dot( axis ) ) * size.y * 0.5 +
		Math.abs( axes[ 2 ].dot( axis ) ) * size.z * 0.5;

	let best = - Infinity;
	const test = axis => {
		const distance = Math.abs( _delta.dot( axis ) ) - project( A, a.size, axis ) - project( B, b.size, axis );
		if ( distance <= best ) return;
		best = distance;
		if ( outAxis ) {
			outAxis.copy( axis );
			if ( _delta.dot( axis ) < 0 ) outAxis.negate();
		}
	};

	for ( let i = 0; i < 3; i ++ ) test( A[ i ] );
	for ( let i = 0; i < 3; i ++ ) test( B[ i ] );

	for ( let i = 0; i < 3; i ++ ) {
		for ( let j = 0; j < 3; j ++ ) {
			_cross.crossVectors( A[ i ], B[ j ] );
			if ( _cross.lengthSq() > 1e-10 ) test( _cross.normalize() );
		}
	}

	return best;
}

/**
 * Distance from `box` to the nearest of `others`: positive when it is clear
 * of all of them, zero when touching, negative when it overlaps. Unclamped on
 * purpose — the contact search needs to see how much room is left, not just
 * whether any is gone.
 */
function gapTo( box, others ) {
	let nearest = Infinity;
	for ( const other of others ) nearest = Math.min( nearest, obbSeparation( box, other ) );
	return nearest;
}

/**
 * Seating a box against the support *plane* only guarantees it touches that
 * infinite plane, not the finite face below it, so the box is lowered along
 * the plane normal until the two solids genuinely meet.
 *
 * Boxes sit flat now, which already lands them on the face, so this is a
 * guard rather than a correction — it is what keeps the invariant if a future
 * change ever seats a box at an angle again.
 */
function seatOnSupport( box, support, normal ) {
	if ( ! support ) return box;
	if ( obbSeparation( support, box ) <= CONTACT_TOLERANCE ) return box;

	const origin = box.position.clone();
	const probe = drop => {
		box.position.copy( origin ).addScaledVector( normal, - drop );
		return obbSeparation( support, box );
	};

	let low = 0;
	let high = 0.02;
	while ( probe( high ) > 0 && high < 16 ) high *= 2;

	for ( let i = 0; i < 48; i ++ ) {
		const mid = ( low + high ) / 2;
		if ( probe( mid ) > 0 ) low = mid; else high = mid;
	}

	probe( high );
	return box;
}

function groundPlane( x, z ) {
	return {
		point: new Vector3( x, GROUND, z ),
		normal: new Vector3( 0, 1, 0 ),
		u: new Vector3( 1, 0, 0 ),
		v: new Vector3( 0, 0, 1 ),
		halfU: 0,
		halfV: 0,
	};
}

/** The top face of a placed box, ready to carry the next one. */
function topPlane( box ) {
	const half = box.size.clone().multiplyScalar( 0.5 );
	const up = new Vector3( 0, 1, 0 ).applyQuaternion( box.quaternion );
	return {
		point: box.position.clone().addScaledVector( up, half.y ),
		normal: up,
		u: new Vector3( 1, 0, 0 ).applyQuaternion( box.quaternion ),
		v: new Vector3( 0, 0, 1 ).applyQuaternion( box.quaternion ),
		halfU: half.x,
		halfV: half.z,
	};
}

/**
 * Seat a box flat on a plane, turned by `yaw` about the plane normal. Flat is
 * the only option on purpose: tilting it here would leave the box balanced on
 * a single edge, with nothing holding the raised side up.
 */
function restOnPlane( plane, size, yaw, offsetU, offsetV ) {
	const half = size.clone().multiplyScalar( 0.5 );

	const basis = new Matrix4().makeBasis( plane.u, plane.normal, plane.v );
	const quaternion = new Quaternion().setFromRotationMatrix( basis );
	quaternion.multiply( new Quaternion().setFromAxisAngle( new Vector3( 0, 1, 0 ), yaw ) );

	const position = plane.point.clone()
		.addScaledVector( plane.u, offsetU )
		.addScaledVector( plane.v, offsetV )
		.addScaledVector( plane.normal, extentAlong( quaternion, half, plane.normal ) );

	return { size: size.clone(), position, quaternion };
}

function buildTower( rng, cfg, plane, count, boxes, stackId ) {
	// Keeping the whole tower square is just "never turn anything": a yaw of
	// zero is measured against the box below, not against the world.
	const baseYaw = range( rng, - Math.PI, Math.PI );

	let footprintX = range( rng, cfg.footprint[ 0 ], cfg.footprint[ 1 ] );
	let footprintZ = footprintX * range( rng, 0.55, 1.5 );
	let current = plane;
	let support = null;

	for ( let i = 0; i < count; i ++ ) {
		if ( i > 0 ) {
			const shrink = range( rng, cfg.shrink[ 0 ], cfg.shrink[ 1 ] );
			const vary = cfg.parallel ? 1 : range( rng, 0.85, 1.2 );
			footprintX = clamp( current.halfU * 2 * shrink * vary, 0.35, current.halfU * 2 * 1.15 );
			footprintZ = clamp( current.halfV * 2 * shrink * ( cfg.parallel ? 1 : range( rng, 0.85, 1.2 ) ), 0.35, current.halfV * 2 * 1.15 );
		}

		const size = new Vector3( footprintX, range( rng, cfg.height[ 0 ], cfg.height[ 1 ] ), footprintZ );

		const yaw = i === 0 ? baseYaw : ( cfg.parallel ? 0 : range( rng, - Math.PI, Math.PI ) );

		// Offsets stay well inside the support so the centre of mass never
		// leaves it, even when the box itself overhangs.
		const reach = cfg.offset * 0.7;
		const offsetU = i === 0 ? 0 : range( rng, - 1, 1 ) * current.halfU * reach;
		const offsetV = i === 0 ? 0 : range( rng, - 1, 1 ) * current.halfV * reach;

		const box = restOnPlane( current, size, yaw, offsetU, offsetV );
		seatOnSupport( box, support, current.normal );
		box.kind = 'stacked';
		box.stack = stackId;
		box.level = i;
		boxes.push( box );

		support = box;
		current = topPlane( box );
	}

	return current;
}

/** Highest point and horizontal reach of a set of boxes, for aiming leaners. */
function towerMetrics( boxes ) {
	let top = GROUND;
	let reach = 0;
	const centre = new Vector3();

	for ( const box of boxes ) {
		const half = box.size.clone().multiplyScalar( 0.5 );
		top = Math.max( top, box.position.y + extentAlong( box.quaternion, half, new Vector3( 0, 1, 0 ) ) );
		reach = Math.max( reach, Math.hypot( half.x, half.z ) );
		centre.add( box.position );
	}

	centre.divideScalar( boxes.length || 1 );
	return { top, reach, centre };
}

/**
 * A plank stood up against a tower. Its foot is seated on the ground the same
 * way everything else is; then it is slid bodily towards the tower until it
 * just touches. Aiming it analytically is not enough — where a given aim
 * first meets the tower depends on which faces it approaches and at what
 * angle — so the travel is searched instead, and the search stops on the
 * near side of contact. Boxes lean on each other; they never merge.
 */
function makeLeaner( rng, tower, others ) {
	const { top, reach, centre } = tower;

	const lean = range( rng, 52, 72 ) * DEG;
	const contactHeight = clamp( range( rng, 0.4, 0.85 ) * top, 0.6, Math.max( top - 0.15, 0.6 ) );
	const length = contactHeight / Math.sin( lean ) * range( rng, 1.0, 1.18 );

	const heading = range( rng, - Math.PI, Math.PI );
	const towards = new Vector3( Math.cos( heading ), 0, Math.sin( heading ) );
	const axis = towards.clone().multiplyScalar( Math.cos( lean ) ).setY( Math.sin( lean ) ).normalize();

	const size = new Vector3( range( rng, 0.35, 0.7 ), length, range( rng, 0.22, 0.45 ) );
	const half = size.clone().multiplyScalar( 0.5 );

	// Long axis along the lean, then spun about itself so its faces are not
	// all square to the world.
	const quaternion = new Quaternion().setFromUnitVectors( new Vector3( 0, 1, 0 ), axis );
	quaternion.multiply( new Quaternion().setFromAxisAngle( new Vector3( 0, 1, 0 ), range( rng, - Math.PI, Math.PI ) ) );

	const rise = extentAlong( quaternion, half, new Vector3( 0, 1, 0 ) );
	const box = { size, position: new Vector3(), quaternion, kind: 'leaner', stack: - 1 };

	// Distance to the nearest other box: positive is clear, zero is touching.
	const at = slide => {
		box.position.set(
			centre.x - towards.x * ( reach + length * Math.cos( lean ) / 2 - slide ),
			GROUND + rise,
			centre.z - towards.z * ( reach + length * Math.cos( lean ) / 2 - slide ),
		);
		return gapTo( box, others );
	};

	// The gap does not shrink monotonically as the plank slides in — it can
	// pass a corner and open up again — so the whole travel is scanned and
	// the *first* contact taken.
	let from = - reach - 0.5;
	const to = reach + 1.5;
	const steps = 80;

	// Never start the scan already inside something, or the first contact
	// would be missed entirely.
	for ( let i = 0; i < 12 && at( from ) <= 0; i ++ ) from -= 0.5;
	if ( at( from ) <= 0 ) return null;

	let previous = from;
	let bracket = null;

	for ( let i = 1; i <= steps; i ++ ) {
		const slide = from + ( to - from ) * i / steps;
		if ( at( slide ) <= 0 ) { bracket = [ previous, slide ]; break; }
		previous = slide;
	}

	// It never reached anything along its whole travel: a plank propped
	// against thin air is exactly what must not be emitted.
	if ( ! bracket ) return null;

	// Converge from the clear side so the plank settles against the box
	// rather than into it.
	let [ clear, touching ] = bracket;
	for ( let i = 0; i < 44; i ++ ) {
		const mid = ( clear + touching ) / 2;
		if ( at( mid ) > 0 ) clear = mid; else touching = mid;
	}

	at( clear );

	// Whatever it settled against has to be able to hold it up. A plank that
	// comes to rest under an overhang is being pushed down, not supported,
	// and the ground alone cannot keep something standing at an angle.
	for ( const other of others ) {

		if ( obbSeparation( other, box, _push ) > 1e-6 ) continue;
		if ( _push.y > - 0.5 ) return box;

	}

	return null;
}

/**
 * Add boxes propped against a tower, retrying aims that fail to reach it. A
 * prop that cannot find a second contact is dropped rather than left standing
 * at an angle on nothing.
 */
function addLeaners( rng, cfg, boxes, towers, wanted ) {

	let placed = 0;

	for ( let attempt = 0; attempt < wanted * 6 && placed < wanted; attempt ++ ) {

		const target = towers[ Math.floor( rng() * towers.length ) ];
		const leaner = makeLeaner( rng, target, boxes.slice() );
		if ( ! leaner ) continue;

		boxes.push( leaner );
		placed ++;

	}

	return placed;

}

/** @returns {{ boxes: Array, groundY: number, towers: number, leaners: number }} */
export function generateStacking( levelId, rng = Math.random ) {
	const cfg = CONFIG[ levelId ];
	if ( ! cfg ) throw new Error( `unknown level "${levelId}"` );

	const boxes = [];

	if ( ! cfg.total ) {

		buildTower( rng, cfg, groundPlane( 0, 0 ), randInt( rng, cfg.perTower[ 0 ], cfg.perTower[ 1 ] ), boxes, 0 );
		const leaners = addLeaners( rng, cfg, boxes, [ towerMetrics( boxes ) ],
			randInt( rng, cfg.leaners[ 0 ], cfg.leaners[ 1 ] ) );

		return { boxes, groundY: GROUND, towers: 1, leaners };

	}

	// Hardest: budget a whole scene, then spend it.
	const total = randInt( rng, cfg.total[ 0 ], cfg.total[ 1 ] );
	const leaners = randInt( rng, cfg.leaners[ 0 ], cfg.leaners[ 1 ] );
	const loose = randInt( rng, cfg.groundBoxes[ 0 ], cfg.groundBoxes[ 1 ] );

	let budget = Math.max( total - leaners - loose, cfg.perTower[ 0 ] * 2 );
	const towerCount = clamp( randInt( rng, cfg.towers[ 0 ], cfg.towers[ 1 ] ), 1, Math.floor( budget / cfg.perTower[ 0 ] ) );

	const counts = new Array( towerCount ).fill( cfg.perTower[ 0 ] );
	budget -= cfg.perTower[ 0 ] * towerCount;
	while ( budget > 0 ) {
		const i = Math.floor( rng() * towerCount );
		if ( counts[ i ] >= cfg.perTower[ 1 ] ) {
			if ( counts.every( c => c >= cfg.perTower[ 1 ] ) ) break;
			continue;
		}
		counts[ i ] ++;
		budget --;
	}

	const footprints = [];

	// Pack the scene as tightly as it will go, then relax outwards rather
	// than dropping a tower on the floor: an arrangement that reads as one
	// composition matters more than hitting the nominal spread.
	const place = radius => {

		for ( let round = 0; round < 4; round ++ ) {

			const spread = cfg.spread * ( 1 + round * 0.35 );

			for ( let attempt = 0; attempt < 60; attempt ++ ) {

				const angle = range( rng, - Math.PI, Math.PI );
				const distance = Math.sqrt( rng() ) * spread;
				const x = Math.cos( angle ) * distance;
				const z = Math.sin( angle ) * distance;

				if ( footprints.every( f => Math.hypot( f.x - x, f.z - z ) > f.radius + radius ) ) {

					footprints.push( { x, z, radius } );
					return { x, z };

				}

			}

		}

		return null;

	};

	const towers = [];
	for ( const count of counts ) {
		// Half-diagonal of the widest base a tower can start with.
		const spot = place( cfg.footprint[ 1 ] * 0.95 );
		if ( ! spot ) continue;
		const start = boxes.length;
		buildTower( rng, cfg, groundPlane( spot.x, spot.z ), count, boxes, towers.length );
		towers.push( towerMetrics( boxes.slice( start ) ) );
	}

	for ( let i = 0; i < loose; i ++ ) {
		const size = new Vector3(
			range( rng, 0.5, 1.2 ),
			range( rng, 0.35, 0.9 ),
			range( rng, 0.5, 1.2 ),
		);
		const spot = place( Math.hypot( size.x, size.z ) * 0.6 );
		if ( ! spot ) continue;

		const box = restOnPlane( groundPlane( spot.x, spot.z ), size, range( rng, - Math.PI, Math.PI ), 0, 0 );
		box.kind = 'ground';
		box.stack = - 1;
		boxes.push( box );
	}

	const propped = towers.length ? addLeaners( rng, cfg, boxes, towers, leaners ) : 0;

	return { boxes, groundY: GROUND, towers: towers.length, leaners: propped };
}
