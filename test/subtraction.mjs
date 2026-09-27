// Form subtraction: the carved solid must be one piece, must be a mesh whose
// edges actually pair up, and must not be the same form twice.
//
// The edge check is the load-bearing one. A boolean result is not manifold —
// each source triangle is clipped and re-triangulated on its own, so a face
// that was cut finely meets an untouched one along an edge that is whole on
// one side and split on the other. Every line in the drawing comes from edge
// adjacency, so until those T-junctions are repaired the form is drawn with a
// line straight across each of its flat faces. The known-answer case below
// shows the raw boolean failing that check before the repaired one passes it,
// because a check that cannot demonstrate it detects the bug is not evidence
// the bug is gone.

import { BoxGeometry, BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { repairTJunctions, triangleIndices, weldPositions } from '../src/geomutil.js';
import { makeBrush, meshVolume, subtract } from '../src/intersections.js';
import { buildEdgeData } from '../src/silhouette.js';
import { LEVELS, componentCount, generateSubtraction, GUIDES } from '../src/subtraction.js';

// deterministic rng so a failure is reproducible
function mulberry32(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

const check = (name, ok, detail = '') => {
  console.log(`  ${name.padEnd(46)} ${ok ? 'ok' : '*** FAIL ***'}${detail ? `  ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
};

/**
 * How many edges are used by exactly one triangle. A closed solid has none:
 * every edge is shared by the two faces either side of it. Written here from
 * the positions alone so it does not lean on the code it is judging.
 */
function unmatchedEdges(positions, count, indices) {
  const { ids } = weldPositions(positions, count, 1e-5);
  const edges = new Map();
  const rec = (a, b) => {
    if (a === b) return;
    const k = a < b ? a * 4294967296 + b : b * 4294967296 + a;
    edges.set(k, (edges.get(k) || 0) + 1);
  };
  for (let t = 0; t < indices.length; t += 3) {
    rec(ids[indices[t]], ids[indices[t + 1]]);
    rec(ids[indices[t + 1]], ids[indices[t + 2]]);
    rec(ids[indices[t + 2]], ids[indices[t]]);
  }
  let single = 0;
  for (const n of edges.values()) if (n === 1) single++;
  return single;
}

const unmatchedIn = geometry => {
  const position = geometry.getAttribute('position');
  return unmatchedEdges(position.array, position.count, triangleIndices(geometry));
};

// --- known answer: the boolean is not manifold, and the repair fixes it ----
{
  const raw = subtract(makeBrush(new BoxGeometry(2, 2, 2)), makeBrush(new BoxGeometry(0.6, 0.6, 6)));
  const before = unmatchedIn(raw);
  const rawVolume = meshVolume(raw);

  check('box minus a through slot has the right volume', Math.abs(rawVolume - 7.28) < 1e-6,
    `want 7.280000  got ${rawVolume.toFixed(6)}`);
  check('the raw boolean is not manifold', before > 0, `${before} edges used by one triangle`);

  const fixed = repairTJunctions(raw);
  const after = unmatchedEdges(fixed.position, fixed.position.length / 3,
    Int32Array.from({ length: fixed.position.length / 3 }, (_, i) => i));

  check('the repair pairs every edge up', after === 0, `${before} unmatched before, ${after} after`);

  // The repair may only re-cut the same surface, never move it.
  const repairedGeometry = new BufferGeometry();
  repairedGeometry.setAttribute('position', new BufferAttribute(fixed.position, 3));
  const repairedVolume = meshVolume(repairedGeometry);
  check('the repair does not move the surface', Math.abs(repairedVolume - rawVolume) < 1e-6,
    `${rawVolume.toFixed(6)} -> ${repairedVolume.toFixed(6)}`);

  // What the lines of this solid must add up to, worked out by hand: the 12
  // edges of the cube at 2 each, the two 0.6 square rims where the slot comes
  // out, and the four edges running the slot's length through it. A line
  // drawn across a flat face makes this longer; a crease lost to a T-junction
  // makes it shorter. Segment *count* would say nothing — the repair splits
  // real edges into several pieces, which is not a defect.
  const wanted = 12 * 2 + 2 * 4 * 0.6 + 4 * 2;
  const segments = buildEdgeData(repairedGeometry).hardSegments;
  let drawn = 0;
  for (let i = 0; i < segments.length; i += 6) {
    drawn += Math.hypot(segments[i + 3] - segments[i], segments[i + 4] - segments[i + 1], segments[i + 5] - segments[i + 2]);
  }
  check('the lines drawn are exactly the form\'s edges', Math.abs(drawn - wanted) < 1e-4,
    `want ${wanted.toFixed(3)}  got ${drawn.toFixed(3)} over ${segments.length / 6} segments`);
  console.log();
}

// --- the guide choices are real -------------------------------------------
{
  check('both guide choices are offered', GUIDES.length === 2, GUIDES.map(g => g.id).join(', '));
  console.log();
}

// --- generated forms --------------------------------------------------------
console.log('one piece, edges paired, and no two forms alike\n');

{
  const forms = 16;
  let worstUnmatched = 0, worstUnmatchedSeed = 0, worstRate = 0, split = 0, noCuts = 0;
  let minCuts = Infinity, maxCuts = 0, minRemoved = 1, maxRemoved = 0;
  const signatures = new Set();

  for (let seed = 1; seed <= forms; seed++) {
    const result = generateSubtraction(mulberry32(seed * 7919));
    const geometry = result.geometry;

    // Unmatched edges are never drawn — `buildEdgeData` leaves a one-faced
    // edge alone — so what is left after the repair can only cost a crease,
    // not invent a line. It has to stay a rounding error all the same.
    const unmatched = unmatchedIn(geometry);
    const rate = unmatched / (triangleIndices(geometry).length / 2);
    worstRate = Math.max(worstRate, rate);
    if (unmatched > worstUnmatched) { worstUnmatched = unmatched; worstUnmatchedSeed = seed; }

    if (componentCount(geometry) !== 1) split++;
    if (result.cuts === 0) noCuts++;

    minCuts = Math.min(minCuts, result.cuts);
    maxCuts = Math.max(maxCuts, result.cuts);
    minRemoved = Math.min(minRemoved, result.removed);
    maxRemoved = Math.max(maxRemoved, result.removed);

    // Volume and triangle count together: two runs landing on both by chance
    // would be the same form, which is the thing being ruled out.
    signatures.add(`${meshVolume(geometry).toFixed(6)}|${triangleIndices(geometry).length}`);

    if (result.ghost.solid.length === 0) check(`seed ${seed} ghosts the solid it was carved from`, false);
    if (result.cuts > 0 && result.ghost.cuts.length === 0) check(`seed ${seed} ghosts its cuts`, false);

    geometry.dispose();
  }

  // Determinism: the same seed has to give the same form back.
  const once = generateSubtraction(mulberry32(4242));
  const twice = generateSubtraction(mulberry32(4242));
  const deterministic = Math.abs(meshVolume(once.geometry) - meshVolume(twice.geometry)) < 1e-12;
  once.geometry.dispose(); twice.geometry.dispose();

  const ok = worstRate < 0.005 && split === 0 && noCuts === 0
    && signatures.size === forms && deterministic && maxRemoved <= 0.55 && minCuts >= 1;

  console.log(`${forms} forms — cuts ${minCuts}-${maxCuts}, removed ${
    (minRemoved * 100).toFixed(0)}-${(maxRemoved * 100).toFixed(0)}%, ` +
    `unmatched edges ${worstUnmatched} (${(worstRate * 100).toFixed(3)}%${
      worstUnmatched ? `, seed ${worstUnmatchedSeed}` : ''}), ` +
    `split ${split}, uncarved ${noCuts}, distinct ${signatures.size}/${forms}${
      deterministic ? '' : ', NOT DETERMINISTIC'}`);
  console.log(`  ${ok ? 'PASS' : '*** FAIL ***'}`);
  if (!ok) process.exitCode = 1;
}

// Sample the procedural space at every level: actual mesh topology, a real
// through-cut ray, complexity bounds, and diversity of independent parameters.
for (const level of LEVELS) {
  let valid = true, curved = 0, square = 0, pockets = 0, sideCuts = 0;
  const radii = new Set(), positions = new Set(), signatures = new Set();
  for (let seed = 1; seed <= 30; seed++) {
    const result = generateSubtraction(mulberry32(seed * 4451), level.id);
    const geometry = result.geometry;
    const unmatchedRate = unmatchedIn(geometry) / (triangleIndices(geometry).length / 2);
    valid &&= componentCount(geometry) === 1 && unmatchedRate < 0.005;
    valid &&= result.cuts >= level.cuts[0] && result.cuts <= level.cuts[1];
    valid &&= result.removed >= 0.04 && result.removed <= 0.55;
    for (const r of result.corners) radii.add(r.toFixed(4));
    signatures.add(`${meshVolume(geometry).toFixed(6)}|${triangleIndices(geometry).length}`);
    for (const cut of result.operations) {
      positions.add(`${cut.x.toFixed(4)},${cut.y.toFixed(4)}`);
      if (cut.curved) curved++; else square++;
      if (cut.pocket) pockets++;
      if (cut.axis !== 2) sideCuts++;
    }
    const first = result.operations[0];
    if (!first.pocket) {
      const material = new MeshBasicMaterial({ side: DoubleSide });
      const mesh = new Mesh(geometry, material);
      const ray = new Raycaster(new Vector3(first.x * result.scale, first.y * result.scale, 10), new Vector3(0, 0, -1));
      valid &&= ray.intersectObject(mesh).length === 0;
      material.dispose();
    }
    if (!valid) console.log(`  failing procedural seed ${seed}, level ${level.id}, unmatched ${unmatchedRate}`);
    geometry.dispose();
  }
  check(`${level.id}: connected, bounded, diverse cuts`, valid && signatures.size === 30 && radii.size > 20 && positions.size >= 30);
  check(`${level.id}: mixed cutter shapes`, curved > 0 && square > 0);
  check(`${level.id}: depth and face complexity`, level.id === 'easier' ? pockets === 0 && sideCuts === 0 : pockets > 0 && sideCuts > 0);
}

// A nearly collinear reversed sliver from a boolean must not add a crease
// across a flat face. The long edge is shared with a healthy triangle.
{
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([
    0,0,0, 1,0,0, 0,1,0,
    1,0,0, 0,0,0, 0.5,0.000001,0,
  ]), 3));
  check('boolean slivers do not create stray face lines', buildEdgeData(geometry).hardSegments.length === 0);
  geometry.dispose();
}
