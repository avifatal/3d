import assert from 'node:assert/strict';
import { Box3, Euler, Matrix4, PerspectiveCamera, Vector3, Vector4 } from 'three';
import { perspectiveRays } from '../src/perspective-guides.js';
const bounds = { box: new Box3(new Vector3(-2,-1,-0.5),new Vector3(2,1,0.5)), matrix:new Matrix4() };
const camera = new PerspectiveCamera(42,1.5,0.25,250);
function view(x,y,z) { camera.position.set(x,y,z);camera.lookAt(0,0,0);camera.updateMatrixWorld(true); }
view(0,0,10);
let rays=perspectiveRays(bounds,camera);
assert.equal(rays.length,4,'image-plane axes do not invent a receding direction');
assert.ok(rays.every(r=>r.direction.z===-1&&r.start.z===-0.5));
view(0,0,-10);
rays=perspectiveRays(bounds,camera);
assert.ok(rays.every(r=>r.direction.z===1&&r.start.z===0.5),'orbit flips the far endpoints');
for(let i=0;i<40;i++) {
 view(8*Math.cos(i),3+Math.sin(i),8*Math.sin(i));
 bounds.matrix.makeRotationFromEuler(new Euler(i*0.11,i*0.19,i*0.07));
 const forward=camera.getWorldDirection(new Vector3());
 const inverse=bounds.matrix.clone().invert();
 rays=perspectiveRays(bounds,camera);
 for(const ray of rays) {
  assert.ok(ray.direction.dot(forward)>0,'every extension recedes in camera depth');
  const local=ray.start.clone().applyMatrix4(inverse);
  for(let a=0;a<3;a++) assert.ok(Math.min(Math.abs(local.getComponent(a)-bounds.box.min.getComponent(a)),Math.abs(local.getComponent(a)-bounds.box.max.getComponent(a)))<1e-8,'starts at a box corner');
  const back=ray.start.clone().addScaledVector(ray.direction,-0.01).applyMatrix4(inverse);
  assert.ok(back.getComponent(ray.axis)>bounds.box.min.getComponent(ray.axis)-1e-8&&back.getComponent(ray.axis)<bounds.box.max.getComponent(ray.axis)+1e-8,'extends beyond the far endpoint');
  const a=ray.start.clone().project(camera),b=ray.start.clone().addScaledVector(ray.direction,ray.length).project(camera);
  const direction=ray.direction.clone().transformDirection(camera.matrixWorldInverse);
  const vp=new Vector4(direction.x,direction.y,direction.z,0).applyMatrix4(camera.projectionMatrix);
  assert.ok(Math.abs((b.x-a.x)*(vp.y/vp.w-a.y)-(b.y-a.y)*(vp.x/vp.w-a.x))<1e-7,'projected lines converge to their mathematical vanishing point');
 }
}
const preview=new Matrix4().makeRotationY(0.8).setPosition(2,1,-3);
const during=perspectiveRays(bounds,camera,preview);
const after=perspectiveRays({...bounds,matrix:bounds.matrix.clone().premultiply(preview)},camera);
assert.deepEqual(during,after,'preview and committed object rotations match');
console.log('Perspective guides: receding directions, orbit reversal, vanishing-point convergence and live transforms passed.');
