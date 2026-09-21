// The horizon line.
//
// Eye level is the one reference an artist can draw a whole scene from, and
// the exercise sheets lean on it heavily. It is not a line in the scene: it
// is the vanishing line of the ground plane, where every horizontal direction
// projects to. That is exact and cheap to find — take any direction lying in
// the ground plane, project it as a point at infinity (w = 0), and read off
// its height on screen.
//
// Drawn as a DOM overlay rather than geometry so it stays a crisp single
// pixel at any zoom and never interacts with the depth buffer.

import { Vector3 } from 'three';

const _forward = new Vector3();
const _horizontal = new Vector3();

export class HorizonLine {

	constructor( container ) {

		this.element = document.createElement( 'div' );
		this.element.className = 'horizon';
		this.element.innerHTML = '<span>horizon</span>';
		container.appendChild( this.element );

		this.wanted = true;
		this.lastY = null;

	}

	setVisible( value ) {

		this.wanted = value;
		if ( ! value ) this.element.style.display = 'none';
		else this.lastY = null;

	}

	update( camera, heightPx ) {

		if ( ! this.wanted ) return;

		camera.getWorldDirection( _forward );
		_horizontal.set( _forward.x, 0, _forward.z );

		// Looking straight down or straight up: the ground's vanishing line
		// is off-screen and there is nothing honest to draw.
		if ( _horizontal.lengthSq() < 1e-8 ) {

			this.element.style.display = 'none';
			return;

		}

		_horizontal.normalize().transformDirection( camera.matrixWorldInverse );

		const e = camera.projectionMatrix.elements;
		const clipY = e[ 1 ] * _horizontal.x + e[ 5 ] * _horizontal.y + e[ 9 ] * _horizontal.z;
		const clipW = e[ 3 ] * _horizontal.x + e[ 7 ] * _horizontal.y + e[ 11 ] * _horizontal.z;

		if ( Math.abs( clipW ) < 1e-8 ) {

			this.element.style.display = 'none';
			return;

		}

		const y = ( 1 - clipY / clipW ) / 2 * heightPx;

		if ( ! Number.isFinite( y ) || y < - 200 || y > heightPx + 200 ) {

			this.element.style.display = 'none';
			return;

		}

		if ( this.lastY !== null && Math.abs( y - this.lastY ) < 0.1 ) return;

		this.lastY = y;
		this.element.style.display = '';
		this.element.style.transform = `translateY(${y.toFixed( 1 )}px)`;

	}

}
