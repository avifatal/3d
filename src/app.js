// Scene contents: forms, the curves between them, and the bookkeeping that
// keeps the two in step when forms are added or removed.

import { Box3, Mesh, Vector3 } from 'three';
import { CurveLines, RENDER_ORDER, SegmentLines } from './lines.js';
import { makeBrush, meshVolume } from './intersections.js';
import { buildSurfaceSampler, findPlacement } from './placement.js';
import { createShape, SHAPES } from './shapes.js';
import { buildEdgeData, extractContour, maxContourSegments } from './silhouette.js';

const label = shapeId => SHAPES.find( shape => shape.id === shapeId ).label;

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

		this.showConstruction = false;
		this.showIntersections = true;

		viewer.onFrame( eye => this.updateContours( eye ) );

	}

	/** @returns {{ ok: boolean, reason?: string }} */
	addForm( shapeId ) {

		const shape = createShape( shapeId, this.rng );
		const placement = findPlacement( shape, this.forms, this.rng );

		if ( ! placement ) {

			shape.geometry.dispose();
			return { ok: false, reason: 'no intersecting placement found — try again' };

		}

		const { scene } = this.viewer;
		const geometry = placement.geometry;
		const edgeData = buildEdgeData( geometry );

		const form = {
			id: this.nextId ++,
			shapeId,
			label: label( shapeId ),
			geometry,
			brush: placement.brush,
			box: placement.box,
			volume: placement.volume,
			radius: shape.radius,
			sampler: buildSurfaceSampler( geometry ),
			edgeData,
			links: 0,
		};

		form.mesh = new Mesh( geometry, this.viewer.surfaceMaterial );
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
			shape.construction.map( points => transformPolyline( points, placement.matrix ) ),
			this.viewer.materials.construction,
			this.viewer.materials.constructionHidden,
		).addTo( scene );
		form.constructionLines.setVisible( this.showConstruction );

		this.forms.push( form );

		for ( const pair of placement.pairs ) {

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

		shape.geometry.dispose();
		this.applyMode();
		this.refreshGround();
		this.viewer.lastEye.set( Infinity, 0, 0 );

		return { ok: true, form, pairs: placement.pairs.length };

	}

	removeLast() {

		const form = this.forms.pop();
		if ( ! form ) return false;

		this.intersections = this.intersections.filter( entry => {

			if ( entry.a !== form && entry.b !== form ) return true;

			entry.curve.dispose();
			entry.a.links --;
			entry.b.links --;
			return false;

		} );

		form.mesh.removeFromParent();
		form.hardLines.dispose();
		form.contourLines.dispose();
		form.constructionLines.dispose();
		form.geometry.dispose();

		this.refreshGround();
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

	frame() {

		this.viewer.frameScene( this.bounds() );

	}

	refreshGround() {

		this.viewer.setSceneBounds( this.bounds() );

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

	applyMode() {

		const showHidden = this.viewer.mode === 'xray';

		for ( const form of this.forms ) {

			form.hardLines.setHiddenVisible( showHidden );
			form.contourLines.setHiddenVisible( showHidden );
			form.constructionLines.setHiddenVisible( showHidden && this.showConstruction );

		}

		for ( const entry of this.intersections ) {

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
