import { Box3, Matrix4, Vector3 } from 'three';

/** Tight bounds in the object's own axes, separate from the world AABB used
 * for intersection culling and camera framing. Keep these axes through edits
 * so the cage rotates with the object instead of growing around it. */
export function objectBounds( geometry, frame = new Matrix4() ) {
 const matrix = new Matrix4().extractRotation( frame );
 matrix.setPosition( new Vector3().setFromMatrixPosition( frame ) );
 const inverse = matrix.clone().invert();
 const box = new Box3();
 const point = new Vector3();
 const positions = geometry.getAttribute( 'position' );
 for ( let i = 0; i < positions.count; i ++ ) {
  box.expandByPoint( point.fromBufferAttribute( positions, i ).applyMatrix4( inverse ) );
 }
 return { box, matrix };
}

export function objectCenter( form, target = new Vector3() ) {
 return form.objectBounds.box.getCenter( target ).applyMatrix4( form.objectBounds.matrix );
}
