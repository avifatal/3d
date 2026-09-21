// Fat-line plumbing.
//
// Every line is drawn twice: once depth-tested in full strength, once with
// depth testing off in a washed-out colour. The second pass is what makes the
// x-ray view readable - you see the whole construction, but the part of it
// that is actually hidden behind a form stays visibly subordinate. Turning the
// hidden pass off and letting the occluder meshes paint in the background
// colour gives the opaque hidden-line view instead.

import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';

export const RENDER_ORDER = { occluder: 0, hidden: 1, visible: 2 };

const materials = new Set();

export function createLineMaterial( options ) {

	const material = new LineMaterial( { worldUnits: false, ...options } );
	materials.add( material );
	return material;

}

export function setLineResolution( width, height ) {

	for ( const material of materials ) material.resolution.set( width, height );

}

/**
 * A pair of LineSegments2 over one shared, pre-allocated buffer. The buffer is
 * sized once at construction so that per-frame contour updates only rewrite
 * floats instead of reallocating instanced attributes every frame.
 */
export class SegmentLines {

	constructor( maxSegments, visibleMaterial, hiddenMaterial ) {

		this.capacity = Math.max( maxSegments, 1 );
		this.buffer = new Float32Array( this.capacity * 6 );

		this.geometry = new LineSegmentsGeometry();
		this.geometry.setPositions( this.buffer );
		this.geometry.instanceCount = 0;

		this.visible = new LineSegments2( this.geometry, visibleMaterial );
		this.visible.renderOrder = RENDER_ORDER.visible;
		this.visible.frustumCulled = false;

		this.hidden = new LineSegments2( this.geometry, hiddenMaterial );
		this.hidden.renderOrder = RENDER_ORDER.hidden;
		this.hidden.frustumCulled = false;

	}

	/** `source` may be the internal buffer itself, already written in place. */
	setSegments( source, count ) {

		if ( source !== this.buffer ) this.buffer.set( source.subarray( 0, count * 6 ) );
		this.geometry.attributes.instanceStart.data.needsUpdate = true;
		this.geometry.instanceCount = Math.min( count, this.capacity );

	}

	setHiddenVisible( value ) {

		this.hidden.visible = value;

	}

	setVisible( value ) {

		this.visible.visible = value;
		this.hidden.visible = value;

	}

	addTo( scene ) {

		scene.add( this.visible, this.hidden );
		return this;

	}

	dispose() {

		this.visible.removeFromParent();
		this.hidden.removeFromParent();
		this.geometry.dispose();

	}

}

/** One continuous polyline, drawn as a visible/hidden pair. */
export class CurveLines {

	constructor( polylines, visibleMaterial, hiddenMaterial ) {

		this.objects = [];

		for ( const points of polylines ) {

			const geometry = new LineGeometry();
			geometry.setPositions( points );

			for ( const [ material, order ] of [
				[ hiddenMaterial, RENDER_ORDER.hidden ],
				[ visibleMaterial, RENDER_ORDER.visible ],
			] ) {

				const line = new Line2( geometry, material );
				line.renderOrder = order;
				line.frustumCulled = false;
				// Dashed hidden curves need cumulative distances along the line.
				line.computeLineDistances();
				this.objects.push( line );

			}

		}

	}

	setHiddenVisible( value ) {

		for ( let i = 0; i < this.objects.length; i += 2 ) this.objects[ i ].visible = value;

	}

	setVisible( value ) {

		for ( const object of this.objects ) object.visible = value;

	}

	addTo( scene ) {

		for ( const object of this.objects ) scene.add( object );
		return this;

	}

	dispose() {

		for ( const object of this.objects ) {

			object.removeFromParent();
			object.geometry.dispose();

		}

		this.objects.length = 0;

	}

}
