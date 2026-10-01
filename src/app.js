// Scene contents: forms, the curves between them, and the bookkeeping that
// keeps the two in step when forms are added or removed.

import { Box3, BoxGeometry, DoubleSide, Matrix4, Mesh, Vector3 } from 'three';
import { CurveLines, RENDER_ORDER, SegmentLines } from './lines.js';
import { intersectionCurves, makeBrush, meshVolume } from './intersections.js';
import { buildSurfaceSampler, findPlacement } from './placement.js';
import { createShape, SHAPES } from './shapes.js';
import { buildEdgeData, extractContour, maxContourSegments } from './silhouette.js';
import { generateQueue, SHAPE_IDS as QUEUE_SHAPE_IDS, THIN_AXIS } from './queueing.js';
import { generateRibbon } from './ribbon.js';
import { generateStacking } from './stacking.js';
import { generateSubtraction } from './subtraction.js';

const label = shapeId => SHAPES.find( shape => shape.id === shapeId ).label;

// Boxes resting face to face share a plane. That is contact, not penetration,
// and running CSG on it yields nothing but coplanar noise, so a pair has to
// overlap by more than this on every axis before it is worth evaluating.
const CONTACT_EPSILON = 2e-3;

function overlapDepth( a, b ) {

	return Math.min(
		Math.min( a.max.x, b.max.x ) - Math.max( a.min.x, b.min.x ),
		Math.min( a.max.y, b.max.y ) - Math.max( a.min.y, b.min.y ),
		Math.min( a.max.z, b.max.z ) - Math.max( a.min.z, b.min.z ),
	);

}

/** The three axes through a box's centre, as an artist would block it in. */
function boxConstruction( box, matrix ) {

	const half = [ box.size.x / 2, box.size.y / 2, box.size.z / 2 ];
	return [ 0, 1, 2 ].map( axis => {

		const points = new Float32Array( 6 );
		points[ axis ] = - half[ axis ];
		points[ axis + 3 ] = half[ axis ];
		return transformPolyline( points, matrix );

	} );

}

/**
 * Turn a form so its smallest dimension lies along `axis`. A queue is slices
 * cut out of one longer volume, so a slab has to be sliced across the run
 * rather than laid along it; in a matrix the same slab faces out of the
 * sheet. Only the variable-proportion box has a meaningful smallest
 * dimension — a cone or a pyramid has an axis it stands on, and turning it
 * off that axis would lay it on its side.
 */
function alignThinAxis( geometry, axis ) {

	geometry.computeBoundingBox();
	const size = geometry.boundingBox.getSize( new Vector3() );
	const thin = size.x <= size.y && size.x <= size.z ? 'x' : size.y <= size.z ? 'y' : 'z';
	if ( thin === axis ) return new Matrix4();

	// A quarter turn about the axis neither of them names swaps the two.
	const swap = [ thin, axis ].sort().join( '' );
	const matrix = new Matrix4();
	if ( swap === 'xy' ) matrix.makeRotationZ( Math.PI / 2 );
	else if ( swap === 'yz' ) matrix.makeRotationX( Math.PI / 2 );
	else matrix.makeRotationY( Math.PI / 2 );

	geometry.applyMatrix4( matrix );
	return matrix;

}

/**
 * Where to stand to see a queue as a queue. Forms laid out along a line that
 * happens to point at the camera pile up into a single silhouette — a true
 * view, and a useless one to draw from — so a new arrangement is framed from
 * across its run rather than down it.
 *
 * The run's bearing is the dominant eigenvector of the positions' horizontal
 * covariance, which for a matrix is the way its columns go, so a sheet ends
 * up faced squarely. A run straight up has no bearing on the ground and keeps
 * whatever azimuth the camera already had.
 */
function acrossAzimuth( items ) {

	const mean = new Vector3();
	for ( const item of items ) mean.add( item.position );
	mean.divideScalar( items.length );

	let xx = 0, xz = 0, zz = 0;

	for ( const item of items ) {

		const x = item.position.x - mean.x;
		const z = item.position.z - mean.z;
		xx += x * x;
		xz += x * z;
		zz += z * z;

	}

	if ( xx + zz < 1e-9 ) return undefined;

	return 0.5 * Math.atan2( 2 * xz, xx - zz ) + Math.PI / 2;

}

/** What the carving exercise's construction guides draw. */
const ghostLines = ( ghost, guides ) =>
	( guides === 'cuts' ? [ ...ghost.solid, ...ghost.cuts ] : ghost.solid );

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

export class FormScene {

	constructor( viewer, rng = Math.random ) {

		this.viewer = viewer;
		this.rng = rng;
		this.forms = [];
		this.intersections = [];
		this.nextId = 1;
		this.selected = null;
		this.onChange = () => {};

		this.showConstruction = false;
		this.showIntersections = true;
		// Stacked boxes sit on a real floor, so the grid belongs at that
		// exact height rather than floated below the lowest form.
		this.groundLevel = null;
		this.carveGhost = null;
		this.carveForm = null;

		viewer.onFrame( eye => this.updateContours( eye ) );

	}

	/**
	 * Build the render objects for one world-baked solid and register the
	 * curves where it meets what is already there. Both exercises come
	 * through here; they differ only in how the geometry was positioned.
	 */
	createForm( { geometry, construction = [], shapeId, label: name, radius, pairs, openSurface = false } ) {

		const { scene } = this.viewer;
		const edgeData = buildEdgeData( geometry, 18, openSurface );

		const form = {
			id: this.nextId ++,
			shapeId,
			label: name,
			geometry,
			brush: openSurface ? null : makeBrush( geometry ),
			box: new Box3().setFromBufferAttribute( geometry.getAttribute( 'position' ) ),
			volume: openSurface ? 0 : meshVolume( geometry ),
			radius,
			sampler: openSurface ? null : buildSurfaceSampler( geometry ),
			edgeData,
			links: 0,
			faint: false,
		};

		form.mesh = new Mesh( geometry, this.viewer.surfaceMaterial );
		if ( openSurface ) {

			// Share lighting uniforms, but render and pick both sides of the paper.
			const material = this.viewer.surfaceMaterial.clone();
			material.uniforms = this.viewer.surfaceMaterial.uniforms;
			material.side = DoubleSide;
			form.mesh.material = material;
			form.mesh.onBeforeRender = () => { material.colorWrite = this.viewer.surfaceMaterial.colorWrite; };

		}
		form.mesh.renderOrder = RENDER_ORDER.occluder;
		form.mesh.castShadow = true;
		form.mesh.receiveShadow = true;
		scene.add( form.mesh );

		form.hardLines = new SegmentLines(
			edgeData.hardSegments.length / 6,
			this.viewer.materials.edge,
			this.viewer.materials.edgeHidden,
		).addTo( scene );
		form.hardLines.setSegments( edgeData.hardSegments, edgeData.hardSegments.length / 6 );

		form.contourLines = new SegmentLines(
			maxContourSegments( edgeData ),
			this.viewer.materials.edge,
			this.viewer.materials.edgeHidden,
		).addTo( scene );

		form.constructionLines = new CurveLines(
			construction,
			this.viewer.materials.construction,
			this.viewer.materials.constructionHidden,
		).addTo( scene );
		form.constructionLines.setVisible( this.showConstruction );

		this.forms.push( form );

		for ( const pair of pairs ) {

			const curve = new CurveLines(
				pair.polylines,
				this.viewer.materials.curve,
				this.viewer.materials.curveHidden,
			).addTo( scene );
			curve.setVisible( this.showIntersections );

			this.intersections.push( { a: form, b: pair.form, curve, ratio: pair.ratio, length: pair.length } );
			form.links ++;
			pair.form.links ++;

		}

		this.applyMode();
		this.viewer.lastEye.set( Infinity, 0, 0 );

		this.onChange();
		return form;

	}

	/**
	 * Curves between a newly placed solid and everything already in the
	 * scene. The intersecting-forms exercise gets these from its placement
	 * search for free. Stacked boxes only ever touch, so the contact test
	 * below rejects every pair before any CSG runs — and if one ever did
	 * overlap, the curve would show up and make the fault visible.
	 */
	intersectAgainstScene( brush, volume, box ) {

		const pairs = [];

		for ( const other of this.forms ) {

			if ( ! other.brush || ! other.box.intersectsBox( box ) ) continue;
			if ( overlapDepth( box, other.box ) < CONTACT_EPSILON ) continue;

			const result = intersectionCurves( brush, other.brush );
			if ( ! result || result.polylines.length === 0 ) continue;

			pairs.push( {
				form: other,
				polylines: result.polylines,
				ratio: result.volume / Math.min( volume, other.volume ),
				length: result.length,
			} );

		}

		return pairs;

	}

	/** @returns {{ ok: boolean, reason?: string }} */
	addForm( shapeId ) {

		const shape = createShape( shapeId, this.rng );
		const placement = findPlacement( shape, this.forms, this.rng );

		if ( ! placement ) {

			shape.geometry.dispose();
			return { ok: false, reason: 'no intersecting placement found — try again' };

		}

		const form = this.createForm( {
			geometry: placement.geometry,
			construction: shape.construction.map( points => transformPolyline( points, placement.matrix ) ),
			shapeId,
			label: label( shapeId ),
			radius: shape.radius,
			pairs: placement.pairs,
		} );

		shape.geometry.dispose();
		this.groundLevel = null;
		this.refreshGround();

		return { ok: true, form, pairs: placement.pairs.length };

	}

	/**
	 * Replace the scene with a fresh box-stacking arrangement.
	 * @returns {{ boxes: number, stacks: number, leaners: number }}
	 */
	stack( levelId ) {

		this.clear();

		const { boxes, groundY } = generateStacking( levelId, this.rng );
		const matrix = new Matrix4();
		const stacks = new Set();
		let leaners = 0;

		for ( const box of boxes ) {

			matrix.compose( box.position, box.quaternion, new Vector3( 1, 1, 1 ) );
			const geometry = new BoxGeometry( box.size.x, box.size.y, box.size.z ).applyMatrix4( matrix );

			const brush = makeBrush( geometry );
			const volume = meshVolume( geometry );
			const bounds = new Box3().setFromBufferAttribute( geometry.getAttribute( 'position' ) );

			this.createForm( {
				geometry,
				construction: boxConstruction( box, matrix ),
				shapeId: 'box',
				label: box.kind === 'leaner' ? 'Leaning box' : 'Box',
				radius: box.size.length() / 2,
				pairs: this.intersectAgainstScene( brush, volume, bounds ),
			} );

			if ( box.kind === 'leaner' ) leaners ++;
			else if ( box.stack >= 0 ) stacks.add( box.stack );

		}

		this.groundLevel = groundY;
		this.refreshGround();
		this.frame();

		return { boxes: boxes.length, stacks: stacks.size, leaners };

	}

	/**
	 * Replace the scene with a queue or a matrix of one repeated form.
	 *
	 * Unlike the other two exercises this builds the form *once* and reuses
	 * it: every copy is the same solid, so the only thing that differs
	 * between them on screen is perspective, which is the whole exercise.
	 *
	 * @param {'queue'|'matrix'} arrangement
	 * @param {string} shapeId  one of the queue's shapes, or `random`
	 * @returns {{ forms: number, rows: number, columns: number, shapeId: string }}
	 */
	queue( arrangement, levelId, shapeId ) {

		this.clear();

		const chosen = shapeId === 'random'
			? QUEUE_SHAPE_IDS[ Math.floor( this.rng() * QUEUE_SHAPE_IDS.length ) ]
			: shapeId;

		const shape = createShape( chosen, this.rng );
		const align = chosen === 'boxProportions'
			? alignThinAxis( shape.geometry, THIN_AXIS[ arrangement ] )
			: new Matrix4();
		const construction = shape.construction.map( points => transformPolyline( points, align ) );

		shape.geometry.computeBoundingBox();
		const size = shape.geometry.boundingBox.getSize( new Vector3() );

		const { items, rows, columns } = generateQueue( arrangement, levelId, size, this.rng );
		const matrix = new Matrix4();
		const one = new Vector3( 1, 1, 1 );

		for ( const item of items ) {

			matrix.compose( item.position, item.quaternion, one );
			const geometry = shape.geometry.clone().applyMatrix4( matrix );

			const brush = makeBrush( geometry );
			const volume = meshVolume( geometry );
			const bounds = new Box3().setFromBufferAttribute( geometry.getAttribute( 'position' ) );

			this.createForm( {
				geometry,
				construction: construction.map( points => transformPolyline( points, matrix ) ),
				shapeId: chosen,
				label: label( chosen ),
				// The generator solves every gap exactly, so there is nothing
				// here to intersect. This is still asked rather than assumed:
				// if that ever stopped being true, curves would appear on
				// screen instead of forms quietly overlapping.
				pairs: this.intersectAgainstScene( brush, volume, bounds ),
				radius: shape.radius,
			} );

		}

		shape.geometry.dispose();

		// Nothing rests on the ground here, so the grid finds its own level
		// below the arrangement. The camera is levelled instead: the horizon
		// is the eye line, and this exercise is about distance from it.
		this.groundLevel = null;
		this.refreshGround();
		this.frame( { pitch: 0, azimuth: acrossAzimuth( items ) } );

		return { forms: items.length, rows, columns, shapeId: chosen };

	}

	/**
	 * Replace the scene with one procedurally generated solid, carved.
	 *
	 * The result is a single form with no intersections — the cuts are gone,
	 * not overlapping — so what would be the curve pass is empty and the
	 * drawing is carried entirely by hard edges and contours.
	 *
	 * @param {'solid'|'cuts'} guides  what the construction lines ghost
	 * @returns {{ cuts: number, removed: number }}
	 */
	carve( guides, level = 'easier' ) {

		this.clear();

		const result = generateSubtraction( this.rng, level );
		result.geometry.computeBoundingSphere();

		this.carveGhost = result.ghost;
		this.carveForm = this.createForm( {
			geometry: result.geometry,
			construction: ghostLines( result.ghost, guides ),
			shapeId: 'carved',
			label: 'Carved form',
			radius: result.geometry.boundingSphere.radius,
			pairs: [],
		} );

		this.groundLevel = null;
		this.refreshGround();
		this.frame();

		return { cuts: result.cuts, removed: result.removed };

	}

	/** Replace the scene with an open ribbon, without solid-volume CSG. */
	ribbon( level = 'easier' ) {

		const result = generateRibbon( level, this.rng );
		this.clear();
		this.createForm( {
			geometry: result.geometry,
			construction: result.construction,
			shapeId: 'ribbon',
			label: 'Ribbon',
			radius: result.geometry.boundingSphere.radius,
			pairs: [],
			openSurface: true,
		} );
		this.groundLevel = null;
		this.refreshGround();
		this.frame();
		return { bends: result.bends };

	}

	/**
	 * Swap what the construction guides ghost without generating a new form —
	 * the form on screen is the one being drawn, and changing what is shown
	 * around it must not take it away.
	 */
	setCarveGuides( guides ) {

		const form = this.carveForm;
		if ( ! form || this.forms[ 0 ] !== form || ! this.carveGhost ) return;

		form.constructionLines.dispose();
		form.constructionLines = new CurveLines(
			ghostLines( this.carveGhost, guides ),
			this.viewer.materials.construction,
			this.viewer.materials.constructionHidden,
		).addTo( this.viewer.scene );
		form.constructionLines.setVisible( this.showConstruction );
		this.applyMode();

	}

	select( form ) {

		this.selected = this.forms.includes( form ) ? form : null;
		this.onChange();

	}

	setFaint( form, faint ) {

		if ( ! this.forms.includes( form ) ) return;
		form.faint = faint;
		// Keep the mesh for picking, but remove its occlusion and shadow.
		form.mesh.visible = ! faint;
		form.mesh.castShadow = ! faint;
		this.applyMode();
		this.onChange();

	}

	removeLast() {

		return this.removeForm( this.forms.at( - 1 ) );

	}

	removeForm( form ) {

		const index = this.forms.indexOf( form );
		if ( index < 0 ) return false;
		this.forms.splice( index, 1 );
		if ( this.selected === form ) this.selected = null;
		if ( this.carveForm === form ) {

			this.carveForm = null;
			this.carveGhost = null;

		}

		this.intersections = this.intersections.filter( entry => {

			if ( entry.a !== form && entry.b !== form ) return true;

			entry.curve.dispose();
			entry.a.links --;
			entry.b.links --;
			return false;

		} );

		form.mesh.removeFromParent();
		if ( form.mesh.material !== this.viewer.surfaceMaterial ) form.mesh.material.dispose();
		form.hardLines.dispose();
		form.contourLines.dispose();
		form.constructionLines.dispose();
		form.geometry.dispose();

		this.refreshGround();
		this.onChange();
		return true;

	}

	clear() {

		while ( this.forms.length ) this.removeLast();

	}

	regenerate( count = 4 ) {

		this.clear();

		const ids = SHAPES.map( shape => shape.id );
		let added = 0;
		let attempts = 0;

		while ( added < count && attempts < count * 4 ) {

			attempts ++;
			const shapeId = ids[ Math.floor( this.rng() * ids.length ) ];
			if ( this.addForm( shapeId ).ok ) added ++;

		}

		this.frame();
		return added;

	}

	bounds() {

		const box = new Box3();
		for ( const form of this.forms ) box.union( form.box );
		return box;

	}

	frame( view = null ) {

		this.viewer.frameScene( this.bounds(), view );

	}

	refreshGround() {

		this.viewer.setSceneBounds( this.bounds(), this.groundLevel );

	}

	updateContours( eye ) {

		for ( const form of this.forms ) {

			const buffer = form.contourLines.buffer;
			const count = extractContour( form.edgeData, eye.x, eye.y, eye.z, buffer );
			form.contourLines.setSegments( buffer, count );

		}

	}

	setMode( mode ) {

		this.viewer.setMode( mode );
		this.applyMode();

	}

	setLinesFaint( lines, faint ) {

		const objects = lines.objects ?? [ lines.visible, lines.hidden ];
		for ( const object of objects ) {

			object.userData.normalMaterial ??= object.material;
			const normal = object.userData.normalMaterial;
			object.material = faint ? this.viewer.faintMaterials.get( normal ) : normal;

		}

	}

	applyMode() {

		const showHidden = this.viewer.mode === 'xray';

		for ( const form of this.forms ) {

			this.setLinesFaint( form.hardLines, form.faint );
			this.setLinesFaint( form.contourLines, form.faint );
			this.setLinesFaint( form.constructionLines, form.faint );
			form.hardLines.setHiddenVisible( showHidden );
			form.contourLines.setHiddenVisible( showHidden );
			form.constructionLines.setHiddenVisible( showHidden && this.showConstruction );

		}

		for ( const entry of this.intersections ) {

			this.setLinesFaint( entry.curve, entry.a.faint || entry.b.faint );
			entry.curve.setHiddenVisible( showHidden && this.showIntersections );

		}

	}

	setConstructionVisible( value ) {

		this.showConstruction = value;
		for ( const form of this.forms ) form.constructionLines.setVisible( value );
		this.applyMode();

	}

	setIntersectionsVisible( value ) {

		this.showIntersections = value;
		for ( const entry of this.intersections ) entry.curve.setVisible( value );
		this.applyMode();

	}

	stats() {

		const curveCount = this.intersections.reduce( ( total, entry ) => total + entry.curve.objects.length / 2, 0 );
		return { forms: this.forms.length, pairs: this.intersections.length, curves: curveCount };

	}

}
