import { Matrix4, Object3D } from 'three';
import { objectCenter } from './object-bounds.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

export class ObjectEditor {
 constructor( viewer, scene, onPreview, onCommit ) {
  this.viewer = viewer;
  this.scene = scene;
  this.onPreview = onPreview;
  this.onCommit = onCommit;
  this.mode = 'select';
  this.form = null;
  this.gesture = false;
  this.history = [];
  this.proxy = new Object3D();
  viewer.scene.add( this.proxy );
  const canvas = viewer.renderer.domElement;
  this.controls = new TransformControls( viewer.camera, canvas );
  this.controls.setSize( 0.85 );
  viewer.scene.add( this.controls.getHelper() );
  this.controls.addEventListener( 'mouseDown', () => this.begin() );
  this.controls.addEventListener( 'objectChange', () => this.preview() );
  this.controls.addEventListener( 'mouseUp', () => this.finish() );
  // OrbitControls was registered first. Intercept handle presses in capture
  // phase, before it can start a camera gesture (including on touch screens).
  canvas.addEventListener( 'pointerdown', event => {
   if ( !this.controls.object || event.button !== 0 ) return;
   const rect = canvas.getBoundingClientRect();
   this.controls.pointerHover( { x: (event.clientX-rect.left)/rect.width*2-1, y: -(event.clientY-rect.top)/rect.height*2+1, button: 0 } );
   if ( !this.controls.axis ) return;
   this.gesture = true;
   this.orbitEnabled = viewer.controls.enabled;
   viewer.controls.enabled = false;
  }, true );
  canvas.addEventListener( 'pointerup', () => {
   // Keep the flag until all selection listeners have processed pointerup.
   setTimeout( () => { this.gesture = false; }, 0 );
  } );
  canvas.addEventListener( 'pointercancel', () => { this.cancel(); this.gesture = false; } );
  window.addEventListener( 'blur', () => this.cancel() );
 }
 setMode( mode ) {
  if ( this.start ) return;
  this.mode = mode;
  if ( mode !== 'select' ) this.controls.setMode( mode );
  this.sync();
 }
 sync() {
  this.history = this.history.filter( entry => this.scene.forms.includes( entry.form ) );
  const form = this.scene.selected;
  if ( this.start && ( form !== this.form || form?.faint ) ) this.cancel();
  this.form = form;
  if ( this.start ) return;
  if ( !form || form.faint || this.mode === 'select' ) this.controls.detach();
  else {
   objectCenter( form, this.proxy.position );
   this.proxy.quaternion.identity();
   this.proxy.updateMatrixWorld( true );
   this.controls.attach( this.proxy );
  }
  for ( const button of document.querySelectorAll( '[data-transform]' ) ) {
   button.classList.toggle( 'active', button.dataset.transform === this.mode );
   button.disabled = button.dataset.transform !== 'select' && ( !form || form.faint );
  }
  document.getElementById( 'undoTransform' ).disabled = !this.history.length;
 }
 begin() {
  if ( !this.form ) return;
  // Drain orbit inertia without changing the user's camera-lock setting.
  const rotate = this.viewer.controls.enableRotate;
  this.viewer.setCameraLocked( true );
  this.viewer.controls.enableRotate = rotate;
  this.start = new Matrix4().makeTranslation( ...objectCenter( this.form ).toArray() );
 }
 delta() {
  this.proxy.updateMatrix();
  return this.proxy.matrix.clone().multiply( this.start.clone().invert() );
 }
 preview() {
  if ( !this.start ) return;
  const delta = this.delta();
  this.scene.previewTransform( this.form, delta );
  this.onPreview( this.form );
 }
 finish() {
  if ( !this.start ) return;
  const delta = this.delta();
  const form = this.form;
  this.start = null;
  this.viewer.controls.enabled = this.orbitEnabled ?? true;
  if ( delta.elements.some( ( v, i ) => Math.abs( v - ( i % 5 === 0 ? 1 : 0 ) ) > 1e-7 ) ) {
   this.history.push( { form, inverse: delta.clone().invert() } );
   if ( this.history.length > 30 ) this.history.shift();
   this.scene.transformForm( form, delta );
   this.onCommit();
  } else this.scene.previewTransform( form );
  this.sync();
 }
 cancel() {
  if ( !this.start ) return false;
  this.start = null;
  this.controls.dragging = false;
  this.controls.axis = null;
  this.scene.previewTransform( this.form );
  this.onPreview( this.form );
  this.viewer.controls.enabled = this.orbitEnabled ?? true;
  this.sync();
  return true;
 }
 undo() {
  if ( this.start ) return;
  const entry = this.history.pop();
  if ( entry && this.scene.forms.includes( entry.form ) ) {
   this.scene.transformForm( entry.form, entry.inverse );
   this.onCommit();
  }
  this.sync();
 }
}
