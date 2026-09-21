import { BoxGeometry, IcosahedronGeometry, ConeGeometry, Matrix4, Quaternion, Euler, Vector3 } from 'three';
import { makeBrush, intersectionCurves, meshVolume } from '../src/intersections.js';

const mat = (pos, rot = [0,0,0]) => new Matrix4().compose(
  new Vector3(...pos), new Quaternion().setFromEuler(new Euler(...rot)), new Vector3(1,1,1));
const bake = (g, m) => { const c = g.clone(); c.applyMatrix4(m); return c; };

function run(name, ga, ma, gb, mb) {
  const A = bake(ga, ma), B = bake(gb, mb);
  const t0 = performance.now();
  const res = intersectionCurves(makeBrush(A), makeBrush(B));
  const dt = performance.now() - t0;
  if (!res) { console.log(`${name.padEnd(26)} NO INTERSECTION   (${dt.toFixed(1)}ms)`); return; }
  const closed = res.polylines.map(p => {
    const n = p.length/3;
    const d = Math.hypot(p[0]-p[3*n-3], p[1]-p[3*n-2], p[2]-p[3*n-1]);
    return d < 1e-4 ? 'closed' : 'open';
  });
  const info = res.polylines.map((p,i)=>{let L=0;for(let k=3;k<p.length;k+=3)L+=Math.hypot(p[k]-p[k-3],p[k+1]-p[k-2],p[k+2]-p[k-1]);return `${p.length/3}pt/${L.toFixed(2)}/${closed[i]}`;});
  console.log(`${name.padEnd(26)} loops=${res.polylines.length} [${info.join("  ")}] vol=${res.volume.toFixed(3)} (${dt.toFixed(1)}ms)`);
}

const box = new BoxGeometry(2,2,2);
const sph3 = new IcosahedronGeometry(1, 3);
const sph4 = new IcosahedronGeometry(1, 4);
const cone = new ConeGeometry(0.8, 2.2, 64);
const pyr  = new ConeGeometry(1.0, 1.8, 4);

console.log('tris: box', box.getAttribute('position').count/3, 'ico3', sph3.getAttribute('position').count/3,
            'ico4', sph4.getAttribute('position').count/3, 'cone64', cone.getAttribute('position').count/3);
console.log('vols: box', meshVolume(box).toFixed(3), 'ico4(r=1)', meshVolume(sph4).toFixed(4), '(4/3pi=4.1888)');

run('box ∩ box (corner)',   box, mat([0,0,0]), box, mat([1.4,1.3,1.2], [0.3,0.5,0.2]));
run('box ∩ box (through)',  box, mat([0,0,0]), new BoxGeometry(0.8,0.8,6), mat([0.2,0.3,0], [0,0,0.2]));
run('sphere3 ∩ box corner', box, mat([0,0,0]), sph3, mat([1.2,1.1,1.0]));
run('sphere4 ∩ box corner', box, mat([0,0,0]), sph4, mat([1.2,1.1,1.0]));
run('sphere4 ∩ box face',   box, mat([0,0,0]), sph4, mat([0,1.5,0]));
run('sphere4 ∩ sphere4',    sph4, mat([0,0,0]), sph4, mat([1.2,0.2,0.1]));
run('cone ∩ sphere4',       sph4, mat([0,0,0]), cone, mat([0.4,1.0,0.2], [0.4,0,0.3]));
run('cone ∩ box',           box, mat([0,0,0]), cone, mat([0.5,1.4,0.3], [0.5,0.2,0.4]));
run('pyramid ∩ box',        box, mat([0,0,0]), pyr, mat([1.3,0.8,0.4], [0.9,0.4,0.2]));
run('pyramid ∩ sphere4',    sph4, mat([0,0,0]), pyr, mat([0.9,0.6,0.3], [1.2,0.4,0.2]));
run('disjoint',             box, mat([0,0,0]), sph4, mat([9,0,0]));
run('contained',            box, mat([0,0,0]), new IcosahedronGeometry(0.4,3), mat([0,0,0]));

// --- accuracy: seam points must lie on both parent surfaces ---------------
{
  const R = 1.0;
  const A = bake(new BoxGeometry(2,2,2), mat([0,0,0]));
  const B = bake(new IcosahedronGeometry(R, 5), mat([1.2,1.1,1.0]));
  const res = intersectionCurves(makeBrush(A), makeBrush(B));
  const c = new Vector3(1.2,1.1,1.0);
  let maxSphereErr = 0, maxBoxErr = 0;
  for (const p of res.polylines) {
    for (let i = 0; i < p.length; i += 3) {
      const v = new Vector3(p[i], p[i+1], p[i+2]);
      // ico5 inscribes the sphere, so compare against its own facet radius band
      maxSphereErr = Math.max(maxSphereErr, Math.abs(v.distanceTo(c) - R));
      // on the box boundary => at least one |coord| is 1
      const d = Math.min(Math.abs(Math.abs(v.x)-1), Math.abs(Math.abs(v.y)-1), Math.abs(Math.abs(v.z)-1));
      maxBoxErr = Math.max(maxBoxErr, d);
    }
  }
  console.log(`accuracy  box face dev=${maxBoxErr.toExponential(2)} (want ~0)   ico5 radius dev=${maxSphereErr.toExponential(2)} (facet inset ~2e-3)`);
}
