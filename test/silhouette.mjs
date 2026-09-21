import { BoxGeometry, IcosahedronGeometry, ConeGeometry, Vector3 } from 'three';
import { buildEdgeData, extractContour, maxContourSegments } from '../src/silhouette.js';

function report(name, geometry, eye) {
  const t0 = performance.now();
  const data = buildEdgeData(geometry);
  const build = performance.now() - t0;
  const out = new Float32Array(maxContourSegments(data) * 6);
  const t1 = performance.now();
  const n = extractContour(data, ...eye, out);
  const ex = performance.now() - t1;
  let len = 0;
  for (let i = 0; i < n; i++)
    len += Math.hypot(out[6*i+3]-out[6*i], out[6*i+4]-out[6*i+1], out[6*i+5]-out[6*i+2]);
  console.log(`${name.padEnd(22)} hard=${String(data.hardSegments.length/6).padStart(4)} contourTris=${String(data.contourTriangles).padStart(5)} seg=${String(n).padStart(4)} len=${len.toFixed(4)} build=${build.toFixed(1)}ms extract=${ex.toFixed(2)}ms`);
  return { data, out, n, len };
}

report('box 2^3', new BoxGeometry(2,2,2), [6,5,7]);
report('pyramid (cone 4)', new ConeGeometry(1,2,4), [8,3,6]);

const r = 1.3, d = 12;
const sph = report(`icosphere d7 r=${r}`, new IcosahedronGeometry(r, 7), [0,0,d]);
const exact = 2*Math.PI*r*Math.sqrt(1-(r/d)**2);
console.log(`   contour len ${sph.len.toFixed(4)} vs exact contour circle ${exact.toFixed(4)}  err=${(100*(sph.len/exact-1)).toFixed(2)}%`);
// radial accuracy: contour circle sits at distance r*sqrt(1-r^2/d^2) from the axis through the eye
const want = r*Math.sqrt(1-(r/d)**2);
let maxDev = 0;
for (let i = 0; i < sph.n*2; i++) {
  const p = new Vector3(sph.out[3*i], sph.out[3*i+1], sph.out[3*i+2]);
  maxDev = Math.max(maxDev, Math.abs(Math.hypot(p.x, p.y) - want));
}
console.log(`   max radial deviation from true contour = ${(100*maxDev/r).toFixed(3)}% of radius`);

const cone = report('cone 64seg', new ConeGeometry(1,2,64), [8,3,6]);
// the two silhouette lines of a cone must reach its apex at (0,1,0)
let nearest = Infinity;
for (let i = 0; i < cone.n*2; i++)
  nearest = Math.min(nearest, Math.hypot(cone.out[3*i], cone.out[3*i+1]-1, cone.out[3*i+2]));
console.log(`   contour reaches to ${nearest.toFixed(4)} from the apex (sharp tip => ~0)`);
