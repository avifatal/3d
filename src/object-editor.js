import { Box3, Matrix4, Object3D } from 'three';
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
  this.forms = [];
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
  this.history = this.history.filter( entry => entry.forms.every( form => this.scene.forms.includes( form ) ) );
  const form = this.scene.selected;
  const forms = [ ...this.scene.selection ];
  if ( this.start && ( forms.length !== this.forms.length || forms.some( ( f, i ) => f !== this.forms[ i ] || f.faint ) ) ) this.cancel();
  this.form = form;
  this.forms = forms;
  const editable = forms.length > 0 && forms.every( f => !f.faint );
  if ( this.start ) return;
  if ( !editable || this.mode === 'select' ) this.controls.detach();
  else {
   this.center( this.proxy.position );
   this.proxy.quaternion.identity();
   this.proxy.updateMatrixWorld( true );
   this.controls.attach( this.proxy );
  }
  for ( const button of document.querySelectorAll( '[data-transform]' ) ) {
   button.classList.toggle( 'active', button.dataset.transform === this.mode );
   button.disabled = button.dataset.transform !== 'select' && ( !editable );
  }
  document.getElementById( 'undoTransform' ).disabled = !this.history.length;
 }
 center( target = this.proxy.position.clone() ) {
  if ( this.forms.length === 1 ) return objectCenter( this.forms[ 0 ], target );
  const bounds = new Box3();
  for ( const form of this.forms ) bounds.union( form.box );
  return bounds.getCenter( target );
 }
 begin() {
  if ( !this.forms.length || this.forms.some( form => form.faint ) ) return;
  // Drain orbit inertia without changing the user's camera-lock setting.
  const rotate = this.viewer.controls.enableRotate;
  this.viewer.setCameraLocked( true );
  this.viewer.controls.enableRotate = rotate;
  this.start = new Matrix4().makeTranslation( ...this.center().toArray() );
 }
 delta() {
  this.proxy.updateMatrix();
  return this.proxy.matrix.clone().multiply( this.start.clone().invert() );
 }
 preview() {
  if ( !this.start ) return;
  const delta = this.delta();
  for ( const form of this.forms ) this.scene.previewTransform( form, delta );
  this.onPreview( this.form );
 }
 finish() {
  if ( !this.start ) return;
  const delta = this.delta();
  const forms = [ ...this.forms ];
  this.start = null;
  this.viewer.controls.enabled = this.orbitEnabled ?? true;
  if ( delta.elements.some( ( v, i ) => Math.abs( v - ( i % 5 === 0 ? 1 : 0 ) ) > 1e-7 ) ) {
   this.history.push( { forms, inverse: delta.clone().invert() } );
   if ( this.history.length > 30 ) this.history.shift();
   for ( const form of forms ) this.scene.transformForm( form, delta );
   this.onCommit();
  } else for ( const form of forms ) this.scene.previewTransform( form );
  this.sync();
 }
 cancel() {
  if ( !this.start ) return false;
  this.start = null;
  this.controls.dragging = false;
  this.controls.axis = null;
  for ( const form of this.forms ) this.scene.previewTransform( form );
  this.onPreview( this.form );
  this.viewer.controls.enabled = this.orbitEnabled ?? true;
  this.sync();
  return true;
 }
 undo() {
  if ( this.start ) return;
  const entry = this.history.pop();
  if ( entry && entry.forms.every( form => this.scene.forms.includes( form ) ) ) {
   for ( const form of entry.forms ) this.scene.transformForm( form, entry.inverse );
   this.onCommit();
  }
  this.sync();
 }
}
