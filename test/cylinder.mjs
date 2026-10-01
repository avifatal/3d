import assert from 'node:assert/strict';
import { BoxGeometry, Vector3 } from 'three';
import { createShape } from '../src/shapes.js';
import { intersectionCurves, makeBrush, meshVolume } from '../src/intersections.js';
import { buildEdgeData, extractContour, maxContourSegments } from '../src/silhouette.js';

const { geometry, construction } = createShape('cylinder', () => 0.5);
const radius = 0.75, height = 2.05;
assert.ok(Math.abs(meshVolume(geometry) / (Math.PI * radius ** 2 * height) - 1) < 0.002,
  'Capped cylinder should have the expected solid volume');
for (const guide of construction) assert.ok(guide.every(Number.isFinite));

// Only the two rims are hard edges; the wall must stay smooth.
const data = buildEdgeData(geometry);
assert.ok(data.hardSegments.length > 0);
let rimLength = 0;
for (let i = 0; i < data.hardSegments.length; i += 6) {
  const [x, y, z, u, v, w] = data.hardSegments.slice(i, i + 6);
  assert.ok(Math.abs(Math.abs(y) - height / 2) < 1e-6);
  assert.ok(Math.abs(y - v) < 1e-6, 'No vertical tessellation edges');
  rimLength += Math.hypot(u - x, v - y, w - z);
}
assert.ok(Math.abs(rimLength / (4 * Math.PI * radius) - 1) < 0.002);

const out = new Float32Array(maxContourSegments(data) * 6);
const count = extractContour(data, 0, 0, 10, out);
let contourLength = 0;
for (let i = 0; i < count * 6; i += 6) {
  contourLength += Math.hypot(out[i + 3] - out[i], out[i + 4] - out[i + 1], out[i + 5] - out[i + 2]);
}
assert.ok(Math.abs(contourLength - 2 * height) < 0.01,
  'Side view should have two full-height contours');

// A wide slab cuts both walls, producing two closed circular seams.
const slab = new BoxGeometry(4, 0.5, 4);
const seam = intersectionCurves(makeBrush(geometry), makeBrush(slab));
assert.equal(seam.polylines.length, 2);
for (const line of seam.polylines) {
  assert.ok(Math.hypot(...line.slice(0, 3).map((v, i) => v - line[line.length - 3 + i])) < 1e-5);
  for (let i = 0; i < line.length; i += 3) {
    assert.ok(Math.abs(Math.abs(line[i + 1]) - 0.25) < 1e-5);
    assert.ok(Math.abs(Math.hypot(line[i], line[i + 2]) - radius) < 0.001);
  }
}
geometry.dispose();
slab.dispose();
console.log('Cylinder: solid volume, rim edges, side contours and intersection seams passed.');

// Oblique cylinder pairs used to produce open fragments: extracting edges
// from boolean-clipped triangles introduced branches and dropped short seams.
let seed = 42;
const rng = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
const point = new Vector3();
for (let sample = 0; sample < 20; sample++) {
  const a = createShape('cylinder', rng).geometry;
  const b = createShape('cylinder', rng).geometry;
  b.rotateX(rng() * 3).rotateZ(rng() * 3).translate(0.4, 0.5, 0.2);
  const brushA = makeBrush(a), brushB = makeBrush(b);
  const result = intersectionCurves(brushA, brushB);
  assert.ok(result?.polylines.length, `Pair ${sample}: expected an intersection`);
  for (const line of result.polylines) {
    assert.ok(Math.hypot(line[0] - line.at(-3), line[1] - line.at(-2), line[2] - line.at(-1)) < 1e-5,
      `Pair ${sample}: every seam must close without a gap`);
    for (let i = 3; i < line.length; i += 3) {
      // Check segment midpoints too: joining distant endpoints with a chord
      // would close a loop but cut through the solids instead of following it.
      for (const fraction of [0, 0.5]) {
        point.set(...[0, 1, 2].map(k => line[i + k] * (1 - fraction) + line[i - 3 + k] * fraction));
        for (const mesh of [a, b]) {
          assert.ok(mesh.boundsTree.closestPointToPoint(point).distance < 2e-5,
            `Pair ${sample}: seam must stay on both surfaces`);
        }
      }
    }
  }
  const reverse = intersectionCurves(brushB, brushA);
  assert.ok(Math.abs(reverse.length - result.length) < 1e-4,
    `Pair ${sample}: swapping solids must preserve the seam`);
  a.dispose();
  b.dispose();
}
console.log('20 oblique cylinder pairs: closed seams on both source surfaces passed.');
