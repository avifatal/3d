// Renderer, camera, lighting, and the render passes the drawing styles are
// built on.

import {
	Color, DirectionalLight, GridHelper, Mesh, PCFShadowMap, PerspectiveCamera,
	PlaneGeometry, Scene, ShadowMaterial, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createLineMaterial, RENDER_ORDER, setLineResolution } from './lines.js';
import { HorizonLine } from './horizon.js';
import { createSurfaceMaterial, lightDirection } from './surface.js';
import { THEMES } from './theme.js';

const SHADOW_PLANE = 80;

export class Viewer {

	constructor( container ) {

		this.container = container;
		this.theme = THEMES.paper;
		this.mode = 'xray';
		this.shading = 0;
		this.shadowStrength = 0;
		this.azimuth = 135;
		this.elevation = 48;

		this.renderer = new WebGLRenderer( { antialias: true } );
		this.renderer.setPixelRatio( Math.min( window.devicePixelRatio, 2 ) );
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = PCFShadowMap;
		container.appendChild( this.renderer.domElement );

		this.scene = new Scene();

		// A tight near plane is what buys the depth precision that keeps curves
		// lying on a surface from stippling; the orbit minimum keeps 0.25 safe.
		this.camera = new PerspectiveCamera( 42, 1, 0.25, 250 );
		// Kept low enough that eye level stays inside the frame: pitch down by
		// more than half the field of view and the horizon slides off the top.
		this.camera.position.set( 6.4, 2.9, 8.2 );

		// The pitch that position sits at, kept so an exercise that levels the
		// eye to study it can hand the default back when it is left.
		this.defaultPitch = Math.atan2( this.camera.position.y, Math.hypot( this.camera.position.x, this.camera.position.z ) );

		this.controls = new OrbitControls( this.camera, this.renderer.domElement );
		this.controls.enableDamping = true;
		this.controls.dampingFactor = 0.08;
		this.controls.screenSpacePanning = true;
		this.controls.minDistance = 1.5;
		this.controls.maxDistance = 80;

		// Faces are drawn first, a hair away from the eye, so the lines lying
		// exactly on them still win the depth test. With shading at zero they
		// stop writing colour altogether in x-ray mode, which is what leaves
		// the pure line drawing behind.
		this.surfaceMaterial = createSurfaceMaterial();

		this.light = new DirectionalLight( 0xffffff, 1 );
		this.light.castShadow = true;
		this.light.shadow.mapSize.set( 2048, 2048 );
		this.light.shadow.bias = - 0.0002;
		this.light.shadow.normalBias = 0.05;
		this.scene.add( this.light, this.light.target );

		this.shadowCatcher = new Mesh(
			new PlaneGeometry( SHADOW_PLANE, SHADOW_PLANE ),
			new ShadowMaterial( { transparent: true, opacity: 0, depthWrite: false } ),
		);
		this.shadowCatcher.rotation.x = - Math.PI / 2;
		this.shadowCatcher.receiveShadow = true;
		this.shadowCatcher.renderOrder = - 1;
		this.scene.add( this.shadowCatcher );

		this.materials = {
			edge: createLineMaterial( { color: this.theme.ink, linewidth: 1.7 } ),
			edgeHidden: createLineMaterial( { color: this.theme.inkHidden, linewidth: 1.4, depthTest: false } ),
			curve: createLineMaterial( { color: this.theme.accent, linewidth: 4.2 } ),
			curveHidden: createLineMaterial( {
				color: this.theme.accentHidden, linewidth: 3, depthTest: false,
				dashed: true, dashSize: 0.1, gapSize: 0.07,
			} ),
			// A guide often lies exactly on an edge of the form it was drawn
			// from — the ghost of an uncut solid shares every edge the cutting
			// left alone. Both would then be at the same depth, and which one
			// wins is decided per frame, so the edge underneath comes out
			// stippled. The guide is pushed back a hair so the form's own line
			// always wins.
			construction: createLineMaterial( {
				color: this.theme.construction, linewidth: 1,
				polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2,
			} ),
			constructionHidden: createLineMaterial( {
				color: this.theme.construction, linewidth: 1, depthTest: false, opacity: 0.35, transparent: true,
			} ),
		};

		// Shared faint variants follow the live palette, widths and resolution.
		this.faintMaterials = new Map( Object.values( this.materials ).map( material => {

			const faint = material.clone();
			faint.transparent = true;
			faint.depthWrite = false;
			return [ material, faint ];

		} ) );

		this.horizon = new HorizonLine( container );

		this.grid = null;
		this.gridY = 0;
		this.centre = new Vector3();
		this.radius = 4;
		this.rebuildGrid();
		this.applyTheme();
		this.setMode( this.mode );
		this.setLightAngle( this.azimuth, this.elevation );

		this.frameCallbacks = [];
		this.renderCallbacks = [];
		this.lastEye = new Vector3( Infinity, 0, 0 );

		this.onResize = this.onResize.bind( this );
		window.addEventListener( 'resize', this.onResize );
		this.onResize();

		this.renderer.setAnimationLoop( () => this.tick() );

	}

	setCameraLocked( locked ) {

		this.controls.enableRotate = ! locked;
		if ( ! locked ) return;

		// Clear any remaining orbit inertia without changing the current view.
		const position = this.camera.position.clone();
		const target = this.controls.target.clone();
		const damping = this.controls.enableDamping;
		this.controls.enableDamping = false;
		this.controls.update();
		this.camera.position.copy( position );
		this.controls.target.copy( target );
		this.controls.update();
		this.controls.enableDamping = damping;

	}

	rebuildGrid() {

		// A palette change throws the grid away and builds another one. The
		// **Ground grid** checkbox has to survive that, so the state travels
		// with it rather than being reset to whatever a new helper starts as.
		const visible = this.grid ? this.grid.visible : true;

		if ( this.grid ) {

			this.grid.removeFromParent();
			this.grid.geometry.dispose();
			this.grid.material.dispose();

		}

		this.grid = new GridHelper( 24, 24, this.theme.grid, this.theme.grid );
		this.grid.visible = visible;
		this.grid.material.transparent = true;
		this.grid.material.opacity = 0.5;
		this.grid.material.depthWrite = false;
		this.grid.renderOrder = - 2;
		this.grid.position.y = this.gridY;
		this.scene.add( this.grid );

	}

	/**
	 * Ground height, light rig and shadow camera all follow the scene extent.
	 * `groundY` pins the floor for exercises that have a real one; without it
	 * the grid floats just below the lowest form.
	 */
	setSceneBounds( box, groundY = null ) {

		if ( box.isEmpty() ) {

			this.centre.set( 0, 0, 0 );
			this.radius = 4;
			this.gridY = groundY ?? 0;

		} else {

			box.getCenter( this.centre );
			this.radius = Math.max( box.getSize( new Vector3() ).length() / 2, 1 );
			this.gridY = groundY ?? box.min.y - 0.7;

		}

		this.grid.position.y = this.gridY;
		this.shadowCatcher.position.set( this.centre.x, this.gridY, this.centre.z );
		this.positionLight();

	}

	positionLight() {

		const direction = lightDirection( this.azimuth, this.elevation, new Vector3() );

		// Far enough back that the whole scene, plus the ground it throws onto,
		// fits inside the shadow camera.
		const reach = this.radius * 4 + 6;
		this.light.position.copy( this.centre ).addScaledVector( direction, reach );
		this.light.target.position.copy( this.centre );
		this.light.target.updateMatrixWorld();

		const extent = this.radius * 2.6 + 4;
		const shadowCamera = this.light.shadow.camera;
		shadowCamera.left = - extent;
		shadowCamera.right = extent;
		shadowCamera.top = extent;
		shadowCamera.bottom = - extent;
		shadowCamera.near = 0.5;
		shadowCamera.far = reach * 2 + extent;
		shadowCamera.updateProjectionMatrix();

		this.surfaceMaterial.uniforms.uLightDirection.value.copy( direction );

	}

	setLightAngle( azimuth, elevation ) {

		this.azimuth = azimuth;
		this.elevation = elevation;
		this.positionLight();

	}

	setShading( amount ) {

		this.shading = amount;
		this.surfaceMaterial.uniforms.uShading.value = amount;
		this.updateColorWrite();

	}

	setShadowStrength( amount ) {

		this.shadowStrength = amount;
		this.surfaceMaterial.uniforms.uShadow.value = amount * 0.85;
		this.shadowCatcher.material.opacity = amount * 0.42;
		this.shadowCatcher.visible = amount > 0;
		this.updateColorWrite();

	}

	/**
	 * Faces need to paint colour whenever they carry tone, and in hidden-line
	 * mode where they are what removes the occluded lines. A pure untoned
	 * x-ray leaves them depth-only so the drawing stays on bare paper.
	 */
	updateColorWrite() {

		this.surfaceMaterial.colorWrite =
			this.mode === 'hiddenLine' || this.shading > 0 || this.shadowStrength > 0;

	}

	setTheme( name ) {

		this.theme = THEMES[ name ];
		this.rebuildGrid();
		this.applyTheme();

	}

	applyTheme() {

		const theme = this.theme;
		this.renderer.setClearColor( theme.background );
		this.scene.background = new Color( theme.background );
		this.container.style.setProperty( '--horizon-ink', `#${theme.construction.getHexString()}` );

		this.surfaceMaterial.uniforms.uLit.value.copy( theme.background );
		this.surfaceMaterial.uniforms.uShade.value.copy( theme.shade );
		this.shadowCatcher.material.color.copy( theme.shadow );

		this.materials.edge.color.copy( theme.ink );
		this.materials.edgeHidden.color.copy( theme.inkHidden );
		this.materials.curve.color.copy( theme.accent );
		this.materials.curveHidden.color.copy( theme.accentHidden );
		this.materials.construction.color.copy( theme.construction );
		this.materials.constructionHidden.color.copy( theme.construction );

	}

	/** 'xray' keeps hidden lines faintly drawn; 'hiddenLine' removes them. */
	setMode( mode ) {

		this.mode = mode;
		this.updateColorWrite();

	}

	setGridVisible( value ) {

		this.grid.visible = value;

	}

	setHorizonVisible( value ) {

		this.horizon.setVisible( value );

	}

	setCurveWeight( width ) {

		this.materials.curve.linewidth = width;
		this.materials.curveHidden.linewidth = Math.max( width * 0.7, 1 );

	}

	onFrame( callback ) {

		this.frameCallbacks.push( callback );

	}

	/** Lightweight overlays that also depend on orientation and live edits. */
	onRender( callback ) {

		this.renderCallbacks.push( callback );

	}

	onResize() {

		const { clientWidth: width, clientHeight: height } = this.container;
		if ( width === 0 || height === 0 ) return;

		this.renderer.setSize( width, height );
		// Preserve the user's relative zoom when the tool sheet or orientation
		// changes which dimension limits the view.
		const tangent = Math.tan( this.camera.fov * Math.PI / 360 );
		const oldAngle = Math.atan( tangent * Math.min( 1, this.camera.aspect ) );
		const newAngle = Math.atan( tangent * Math.min( 1, width / height ) );
		this.camera.position.sub( this.controls.target ).multiplyScalar( Math.sin( oldAngle ) / Math.sin( newAngle ) ).add( this.controls.target );
		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();

		const size = this.renderer.getDrawingBufferSize( new Vector2() );
		setLineResolution( size.x, size.y );

		this.lastEye.set( Infinity, 0, 0 );
		this.horizon.lastY = null;

	}

	tick() {

		this.controls.update();

		// Contours only change when the eye does.
		const moved = this.camera.position.distanceToSquared( this.lastEye ) > 1e-10;
		if ( moved ) {

			this.lastEye.copy( this.camera.position );
			for ( const callback of this.frameCallbacks ) callback( this.camera.position );

		}

		this.horizon.update( this.camera, this.container.clientHeight );
		for ( const [ material, faint ] of this.faintMaterials ) {

			faint.color.copy( material.color );
			faint.resolution.copy( material.resolution );
			faint.linewidth = material.linewidth;
			faint.opacity = material.opacity * 0.10;

		}
		for ( const callback of this.renderCallbacks ) callback();
		this.renderer.render( this.scene, this.camera );

	}

	/**
	 * @param {Box3} box
	 * @param {{ pitch?: number, azimuth?: number }|null} view  the angle to
	 *   view from. Whatever it leaves out is taken from where the camera
	 *   already is, so passing nothing keeps the angle the user orbited to. A
	 *   pitch of zero puts eye level exactly through the centre of the scene,
	 *   which is what an exercise about distance from the eye line needs.
	 */
	frameScene( box, view = null ) {

		if ( box.isEmpty() ) return;

		const centre = box.getCenter( new Vector3() );
		const radius = box.getSize( new Vector3() ).length() / 2;
		// Portrait screens are limited by horizontal field of view.
		const halfFov = Math.atan( Math.tan( this.camera.fov * Math.PI / 360 ) * Math.min( 1, this.camera.aspect ) );
		const distance = radius / Math.sin( halfFov ) * 1.05;

		const direction = new Vector3().subVectors( this.camera.position, this.controls.target );
		if ( direction.lengthSq() < 1e-6 ) direction.set( 0.62, 0.29, 0.8 );
		direction.normalize();

		if ( view ) {

			const pitch = view.pitch ?? Math.asin( Math.min( Math.max( direction.y, - 1 ), 1 ) );
			const azimuth = view.azimuth ?? Math.atan2( direction.z, direction.x );
			direction.set(
				Math.cos( pitch ) * Math.cos( azimuth ),
				Math.sin( pitch ),
				Math.cos( pitch ) * Math.sin( azimuth ),
			);

		}

		this.controls.target.copy( centre );
		this.camera.position.copy( centre ).addScaledVector( direction, distance );
		this.controls.update();

	}

}

export { RENDER_ORDER };
