// Object queue & matrix: the forms must never share space, the solved spacing
// must be the tightest one that keeps them apart, and every form must sit on
// the path frame it was given.
//
// The generator solves contact with its own separating-axis routine, so this
// file implements its own rather than importing that one — an assertion that
// reuses the code it is judging cannot fail when that code is wrong. The
// known-answer cases below confirm the two agree before it is trusted, and a
// deliberately naive arc is checked to still be caught.

import { Matrix4, Quaternion, Vector3 } from 'three';
import { ARRANGEMENTS, generateQueue, LEVELS, SHAPE_IDS, THIN_AXIS } from '../src/queueing.js';
import { obbSeparation as shipped } from '../src/stacking.js';

const axesOf = box => {
  const e = new Matrix4().makeRotationFromQuaternion(box.quaternion).elements;
  return [new Vector3(e[0],e[1],e[2]), new Vector3(e[4],e[5],e[6]), new Vector3(e[8],e[9],e[10])];
};

// --- separating-axis distance between two oriented boxes -------------------
// > 0 apart, 0 exactly touching, < 0 interpenetrating by that much.
function obbSeparation(a, b) {
  const A = axesOf(a), B = axesOf(b);
  const ha = a.size.clone().multiplyScalar(0.5), hb = b.size.clone().multiplyScalar(0.5);
  const d = new Vector3().subVectors(b.position, a.position);

  const candidates = [...A, ...B];
  for (const u of A) for (const v of B) {
    const c = new Vector3().crossVectors(u, v);
    if (c.lengthSq() > 1e-10) candidates.push(c.normalize());
  }

  let best = -Infinity;
  for (const L of candidates) {
    const ra = Math.abs(A[0].dot(L))*ha.x + Math.abs(A[1].dot(L))*ha.y + Math.abs(A[2].dot(L))*ha.z;
    const rb = Math.abs(B[0].dot(L))*hb.x + Math.abs(B[1].dot(L))*hb.y + Math.abs(B[2].dot(L))*hb.z;
    best = Math.max(best, Math.abs(d.dot(L)) - ra - rb);
  }
  return best;
}

/**
 * A second opinion by a completely different method: walk a grid of points
 * through one form's volume and ask whether any of them lies inside another.
 * It only catches overlaps thick enough to swallow a sample, which is why it
 * corroborates the separating axis rather than replacing it.
 */
function samplesInsideAnother(items, steps = 5) {
  let hits = 0;

  for (const item of items) {
    const A = axesOf(item), h = item.size.clone().multiplyScalar(0.5);
    for (let i = 0; i < steps; i++) for (let j = 0; j < steps; j++) for (let k = 0; k < steps; k++) {
      const s = n => (n / (steps - 1) - 0.5) * 2;
      const p = item.position.clone()
        .addScaledVector(A[0], s(i) * h.x).addScaledVector(A[1], s(j) * h.y).addScaledVector(A[2], s(k) * h.z);

      for (const other of items) {
        if (other === item) continue;
        const B = axesOf(other), g = other.size.clone().multiplyScalar(0.5);
        const d = new Vector3().subVectors(p, other.position);
        if (Math.abs(d.dot(B[0])) < g.x && Math.abs(d.dot(B[1])) < g.y && Math.abs(d.dot(B[2])) < g.z) hits++;
      }
    }
  }

  return hits;
}

const minSeparation = items => {
  let nearest = Infinity;
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++)
      nearest = Math.min(nearest, obbSeparation(items[i], items[j]));
  return nearest;
};

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

const SIZE = new Vector3(0.62, 1.55, 1.18);

// --- the local separating axis agrees with the shipped one -----------------
{
  const cube = (x, y, z, q = new Quaternion()) =>
    ({ size: new Vector3(1,1,1), position: new Vector3(x,y,z), quaternion: q });

  for (const [name, a, b, want] of [
    ['unit cubes 3 apart',     cube(0,0,0), cube(3,0,0), 2],
    ['unit cubes touching',    cube(0,0,0), cube(1,0,0), 0],
    ['unit cubes overlapping', cube(0,0,0), cube(0.4,0,0), -0.6],
    ['45deg yaw, apart',       cube(0,0,0),
      cube(2,0,0, new Quaternion().setFromAxisAngle(new Vector3(0,1,0), Math.PI/4)), 2 - 0.5 - Math.SQRT1_2],
  ]) {
    const mine = obbSeparation(a, b), theirs = shipped(a, b);
    check(`sat  ${name}`, Math.abs(mine - want) < 1e-9 && Math.abs(theirs - want) < 1e-9,
      `want ${want.toFixed(4)}  local ${mine.toFixed(4)}  shipped ${theirs.toFixed(4)}`);
  }
  console.log();
}

// --- known answer: spacing an arc by centre distance is caught -------------
// Forms evenly spaced *by their centres* along a bend close up on the inside
// of the turn. This is the bug the spacing solver exists to prevent, so the
// check has to be shown failing on it before a clean run means anything.
{
  const count = 7, angle = 150 * Math.PI / 180;
  const pitch = SIZE.x * 1.25;
  const radius = pitch * (count - 1) / angle;

  const naive = [];
  for (let i = 0; i < count; i++) {
    const phi = (i / (count - 1) - 0.5) * angle;
    naive.push({
      size: SIZE,
      position: new Vector3(radius * Math.sin(phi), 0, radius * (Math.cos(phi) - 1)),
      quaternion: new Quaternion().setFromAxisAngle(new Vector3(0,1,0), -phi),
    });
  }

  const gap = minSeparation(naive);
  check('known answer: centre-spaced arc overlaps', gap < 0, `separation ${gap.toFixed(4)}`);
  check('known answer: sampling sees it too', samplesInsideAnother(naive) > 0);

  const solved = generateQueue('queue', 'harder', SIZE, mulberry32(11)).items;
  check('known answer: solved arc does not', minSeparation(solved) > 0, `separation ${minSeparation(solved).toExponential(2)}`);
  console.log();
}

// --- shape list and thin axis ----------------------------------------------
{
  check('sphere is excluded from the shape list', !SHAPE_IDS.includes('sphere'), SHAPE_IDS.join(', '));
  check('every arrangement names a thin axis', ARRANGEMENTS.every(a => THIN_AXIS[a.id]));
  console.log();
}

// --- straight queues are exactly evenly spaced -----------------------------
// A straight run is the one case with an answer that can be written down:
// nothing turns, so the gap between neighbours is the solver's target and the
// centres are one form plus one gap apart.
{
  let worstSpacing = 0, worstGap = 0, scenes = 0;

  for (let seed = 1; seed <= 200; seed++) {
    const { items, gap } = generateQueue('queue', 'easier', SIZE, mulberry32(seed * 6151));
    // Compared component by component rather than with `angleTo`: acos is
    // ill-conditioned at zero and bottoms out around 3e-8 for quaternions
    // that are in fact bit-identical, which is the property being asserted.
    const first = items[0].quaternion;
    if (items.some(item => ['x','y','z','w'].some(k => item.quaternion[k] !== first[k]))) {
      check(`straight queue seed ${seed} keeps one orientation`, false);
      break;
    }

    const step = SIZE.x + gap;
    for (let i = 1; i < items.length; i++) {
      worstSpacing = Math.max(worstSpacing, Math.abs(items[i].position.distanceTo(items[i-1].position) - step));
    }
    worstGap = Math.max(worstGap, Math.abs(minSeparation(items) - gap));
    scenes++;
  }

  check(`straight queue: even spacing (${scenes} scenes)`, worstSpacing < 1e-9, `worst error ${worstSpacing.toExponential(2)}`);
  check('straight queue: gap is exactly the target', worstGap < 1e-9, `worst error ${worstGap.toExponential(2)}`);
  console.log();
}

// --- arcs follow a circle ---------------------------------------------------
// Each form's local +X is the path tangent where it sits, and the defining
// property of a circular arc is that the chord between two neighbours makes
// the same angle with the tangent at each end — and the same angle at every
// step along the run. That is measured from the emitted orientations alone,
// so it tests the frame rather than the code that built the path.
//
// Note this is *not* the same as a constant turn between neighbouring
// orientations: the frame re-derives "up" from world up at every form, so a
// tilted arc rolls the forms as well as turning them.
{
  let worstBisect = 0, worstSpread = 0, worstRoll = 0;

  for (let seed = 1; seed <= 200; seed++) {
    const { items } = generateQueue('queue', 'harder', SIZE, mulberry32(seed * 3221));
    const halves = [];

    for (let i = 1; i < items.length; i++) {
      const chord = new Vector3().subVectors(items[i].position, items[i-1].position).normalize();
      const before = axesOf(items[i-1])[0].angleTo(chord);
      const after = chord.angleTo(axesOf(items[i])[0]);
      worstBisect = Math.max(worstBisect, Math.abs(before - after));
      halves.push((before + after) / 2);
    }

    worstSpread = Math.max(worstSpread, Math.max(...halves) - Math.min(...halves));

    // No roll: local +Y is world up projected perpendicular to the run, so
    // local +Z comes out horizontal. A run straight up has no up left to
    // project and is exempt.
    for (const item of items) {
      const [x, , z] = axesOf(item);
      if (Math.abs(x.y) < 0.999) worstRoll = Math.max(worstRoll, Math.abs(z.y));
    }
  }

  check('arc queue: chord bisects the two tangents', worstBisect < 1e-9, `worst error ${worstBisect.toExponential(2)} rad`);
  check('arc queue: the same turn at every step', worstSpread < 1e-9, `worst spread ${worstSpread.toExponential(2)} rad`);
  check('arc queue: forms are never rolled', worstRoll < 1e-9, `worst roll ${worstRoll.toExponential(2)}`);
  console.log();
}

// --- free curves still run somewhere ---------------------------------------
// A walk that keeps turning the same way comes back on itself, and a queue
// that comes back towards the viewer reads as a heap. Measured end to end
// against the distance travelled, from the emitted positions.
{
  let worst = 1, worstSeed = 0;

  for (let seed = 1; seed <= 200; seed++) {
    const { items } = generateQueue('queue', 'hardest', SIZE, mulberry32(seed * 8171));
    let travelled = 0;
    for (let i = 1; i < items.length; i++) travelled += items[i].position.distanceTo(items[i-1].position);
    const reach = items[items.length-1].position.distanceTo(items[0].position) / travelled;
    if (reach < worst) { worst = reach; worstSeed = seed; }
  }

  check('free curve: the run gets somewhere', worst > 0.35, `worst ${worst.toFixed(3)} of the distance travelled (seed ${worstSeed})`);
  console.log();
}

// --- every arrangement, every level ----------------------------------------
console.log('no two forms share space; spacing is the tightest that keeps them apart\n');

for (const arrangement of ARRANGEMENTS) {
  for (const level of LEVELS) {
    const scenes = 120;
    let worstSeparation = Infinity, slackest = 0, insideHits = 0, offCentre = 0, badBasis = 0;
    let forms = 0, worstSeed = 0;

    for (let seed = 1; seed <= scenes; seed++) {
      const rng = mulberry32(seed * 104729 + level.id.length * 31 + arrangement.id.length);
      const { items, gap } = generateQueue(arrangement.id, level.id, SIZE, rng);
      forms = Math.max(forms, items.length);

      const separation = minSeparation(items);
      if (separation < worstSeparation) { worstSeparation = separation; worstSeed = seed; }
      slackest = Math.max(slackest, separation / gap);
      insideHits += samplesInsideAnother(items);

      // Centred on the origin, so the camera's eye line runs through the
      // middle of the arrangement rather than above or below all of it.
      const min = new Vector3(Infinity,Infinity,Infinity), max = new Vector3(-Infinity,-Infinity,-Infinity);
      for (const item of items) {
        const A = axesOf(item), h = item.size.clone().multiplyScalar(0.5);
        const reach = new Vector3(
          Math.abs(A[0].x)*h.x + Math.abs(A[1].x)*h.y + Math.abs(A[2].x)*h.z,
          Math.abs(A[0].y)*h.x + Math.abs(A[1].y)*h.y + Math.abs(A[2].y)*h.z,
          Math.abs(A[0].z)*h.x + Math.abs(A[1].z)*h.y + Math.abs(A[2].z)*h.z);
        min.min(item.position.clone().sub(reach));
        max.max(item.position.clone().add(reach));
      }
      offCentre = Math.max(offCentre, min.add(max).multiplyScalar(0.5).length());

      // Every orientation must be a proper rotation, or a form is mirrored.
      for (const item of items) {
        const A = axesOf(item);
        const det = A[0].dot(new Vector3().crossVectors(A[1], A[2]));
        if (Math.abs(det - 1) > 1e-9 || Math.abs(item.quaternion.length() - 1) > 1e-9) badBasis++;
      }
    }

    const ok = worstSeparation > 0 && insideHits === 0 && slackest < 1.02 && offCentre < 1e-9 && badBasis === 0;
    console.log(`${arrangement.id}/${level.id}`.padEnd(18) + `${scenes} scenes, up to ${forms} forms — ` +
      `closest approach ${worstSeparation.toExponential(3)} (seed ${worstSeed}), ` +
      `slackest ${slackest.toFixed(4)}× the gap, samples inside ${insideHits}, off centre ${offCentre.toExponential(2)}` +
      (badBasis ? `, mirrored frames ${badBasis}` : ''));
    console.log(`                  ${ok ? 'PASS' : '*** FAIL ***'}`);
    if (!ok) process.exitCode = 1;
  }
}
