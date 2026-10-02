import { ArrowHelper, Vector3 } from 'three';

/** Extend each family of parallel box edges beyond its far face. The sign
 * comes from camera depth, not world X/Y/Z, so orbiting reverses it naturally.
 * An axis parallel to the image plane has a vanishing point at infinity and
 * no receding direction; suppress it instead of flipping on numerical noise.
 */
export function perspectiveRays( bounds, camera, preview = null ) {
 const frame = bounds.matrix.clone();
 if ( preview ) frame.premultiply( preview );
 const forward = camera.getWorldDirection( new Vector3() );
 const size = bounds.box.getSize( new Vector3() );
 const length = size.length() * 0.65;
 if ( length < 1e-6 ) return [];
 const rays = [];
 for ( let axis = 0; axis < 3; axis ++ ) {
  if ( size.getComponent( axis ) < 1e-6 ) continue;
  const direction = new Vector3().setComponent( axis, 1 ).transformDirection( frame );
  const depth = direction.dot( forward );
  if ( Math.abs( depth ) < 0.025 ) continue;
  const far = depth > 0 ? bounds.box.max : bounds.box.min;
  direction.multiplyScalar( Math.sign( depth ) );
  const cross = [ 0, 1, 2 ].filter( component => component !== axis );
  for ( let i = 0; i < 4; i ++ ) {
   const start = new Vector3().setComponent( axis, far.getComponent( axis ) );
   cross.forEach( ( component, bit ) => start.setComponent( component,
    ( i & ( 1 << bit ) ? bounds.box.max : bounds.box.min ).getComponent( component ) ) );
   start.applyMatrix4( frame );
   rays.push( { start, direction: direction.clone(), length, axis } );
  }
 }
 return rays;
}

export class PerspectiveGuides {
 constructor( viewer, scene ) {
  this.viewer = viewer;
  this.scene = scene;
  this.enabled = true;
  this.arrows = Array.from( { length: 12 }, () => {
   const arrow = new ArrowHelper( new Vector3( 1, 0, 0 ), new Vector3(), 1, 0xe76a48 );
   arrow.name = 'perspectiveGuide';
   for ( const part of [ arrow.line, arrow.cone ] ) {
    part.material.depthTest = false;
    part.material.depthWrite = false;
    part.material.transparent = true;
    part.material.opacity = 0.72;
    part.renderOrder = 4;
   }
   arrow.visible = false;
   viewer.scene.add( arrow );
   return arrow;
  } );
 }
 update() {
  const { viewer, scene } = this;
  const form = scene.selected;
  const rays = this.enabled && form && !form.faint
   ? perspectiveRays( form.objectBounds, viewer.camera, form.previewMatrix ) : [];
  const forward = viewer.camera.getWorldDirection( new Vector3() );
  const unitsPerPixel = 2 * Math.tan( viewer.camera.fov * Math.PI / 360 ) / Math.max( viewer.container.clientHeight, 1 );
  for ( let i = 0; i < this.arrows.length; i ++ ) {
   const arrow = this.arrows[ i ], ray = rays[ i ];
   arrow.visible = !!ray;
   if ( !ray ) continue;
   // Keep a small arrowhead legible at any zoom. Clip a start behind the
   // near plane before sizing the head to avoid inverted/giant geometry.
   let { start, length } = ray;
   const depth = start.clone().sub( viewer.camera.position ).dot( forward );
   if ( depth < viewer.camera.near ) {
    const trim = ( viewer.camera.near - depth ) / ray.direction.dot( forward );
    start = start.clone().addScaledVector( ray.direction, trim );
    length -= trim;
   }
   const endDepth = start.clone().addScaledVector( ray.direction, length )
    .sub( viewer.camera.position ).dot( forward );
   if ( length <= 0 || endDepth >= viewer.camera.far ) { arrow.visible = false; continue; }
   const head = Math.min( length * 0.2, endDepth * unitsPerPixel * 8 );
   arrow.position.copy( start );
   arrow.setDirection( ray.direction );
   arrow.setLength( length, head, head * 0.6 );
   arrow.setColor( viewer.theme.accent );
  }
 }
}
