import assert from 'node:assert/strict';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { generateStacking, LEVELS, obbSeparation as shipped } from '../src/stacking.js';

const axesOf = b => {
  const e = new Matrix4().makeRotationFromQuaternion(b.quaternion).elements;
  return [new Vector3(e[0],e[1],e[2]), new Vector3(e[4],e[5],e[6]), new Vector3(e[8],e[9],e[10])];
};

// --- separating-axis distance between two oriented boxes -------------------
// > 0 apart, 0 exactly touching, < 0 interpenetrating by that much.
function obbSeparation(a, b) {
  const axes = box => {
    const e = new Matrix4().makeRotationFromQuaternion(box.quaternion).elements;
    return [new Vector3(e[0],e[1],e[2]), new Vector3(e[4],e[5],e[6]), new Vector3(e[8],e[9],e[10])];
  };
  const A = axes(a), B = axes(b);
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

const lowestY = box => {
  const e = new Matrix4().makeRotationFromQuaternion(box.quaternion).elements;
  const h = box.size.clone().multiplyScalar(0.5);
  const reach = Math.abs(e[1])*h.x + Math.abs(e[5])*h.y + Math.abs(e[9])*h.z;
  return box.position.y - reach;
};

// deterministic rng so a failure is reproducible
function mulberry32(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// The generator solves contact with its own separating-axis routine, so the
// contact assertion would be circular if this file reused it. The local
// implementation above is independent; these known-answer cases confirm the
// two agree before it is trusted to judge the generator.
{
  const cube = (x, y, z, q = new Quaternion()) =>
    ({ size: new Vector3(1,1,1), position: new Vector3(x,y,z), quaternion: q });
  const cases = [
    ['unit cubes 3 apart',      cube(0,0,0), cube(3,0,0),  2],
    ['unit cubes touching',     cube(0,0,0), cube(1,0,0),  0],
    ['unit cubes overlapping',  cube(0,0,0), cube(0.4,0,0), -0.6],
    ['45deg yaw, apart',        cube(0,0,0),
       cube(2,0,0, new Quaternion().setFromAxisAngle(new Vector3(0,1,0), Math.PI/4)), 2 - 0.5 - Math.SQRT1_2],
  ];
  for (const [name, a, b, want] of cases) {
    const mine = obbSeparation(a, b), theirs = shipped(a, b);
    const ok = Math.abs(mine - want) < 1e-9 && Math.abs(theirs - want) < 1e-9;
    console.log(`  sat  ${name.padEnd(24)} want ${want.toFixed(4)}  local ${mine.toFixed(4)}  shipped ${theirs.toFixed(4)}  ${ok ? 'ok' : '*** FAIL ***'}`);
    if (!ok) process.exitCode = 1;
  }
  console.log();
}

const TOUCH = 2e-6;
const RUNS = 300;

for (const level of LEVELS) {
  let scenes = 0, boxes = 0, leaners = 0, leanersTouching = 0;
  let worstGap = 0, worstOverlap = 0, worstGround = 0, sunk = 0;
  let worstLeanerGap = 0;
  let overlaps = 0, worstOverlapAnywhere = 0;

  for (let seed = 1; seed <= RUNS; seed++) {
    const rng = mulberry32(seed * 7919 + level.id.length);
    const { boxes: list, groundY } = generateStacking(level.id, rng);
    scenes++; boxes += list.length;

    // Nothing may sink through the ground.
    for (const b of list) sunk = Math.min(sunk, lowestY(b) - groundY);

    // Consecutive boxes of a tower must touch exactly. Boxes are grouped by
    // their stack id, since a Hardest scene interleaves several towers.
    const stacks = new Map();
    for (const b of list) {
      if (b.kind !== 'stacked') continue;
      if (!stacks.has(b.stack)) stacks.set(b.stack, []);
      stacks.get(b.stack).push(b);
    }

    for (const tower of stacks.values()) {
      tower.sort((x, y) => x.level - y.level);
      let previous = null;
      for (const b of tower) {
        if (previous) {
          const s = obbSeparation(previous, b);
          if (s > 0) worstGap = Math.max(worstGap, s);
          else worstOverlap = Math.min(worstOverlap, s);

        } else {
          worstGround = Math.max(worstGround, Math.abs(lowestY(b) - groundY));
        }
        previous = b;
      }
    }

    // Boxes are solid: no pair anywhere in the scene may share space. This
    // covers stacked, loose and leaning boxes alike — a plank rests against
    // its neighbour, it does not sink into it.
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const s = obbSeparation(list[i], list[j]);
        if (s < -1e-6) { overlaps++; worstOverlapAnywhere = Math.min(worstOverlapAnywhere, s); }
      }
    }

    // ...and a leaning plank must genuinely reach what it leans on.
    for (const b of list) {
      if (b.kind !== 'leaner') continue;
      leaners++;
      let nearest = Infinity;
      for (const other of list) if (other !== b) nearest = Math.min(nearest, obbSeparation(b, other));
      if (nearest <= 1e-6) leanersTouching++;
      worstLeanerGap = Math.max(worstLeanerGap, nearest);
    }
  }

  const avg = (boxes / scenes).toFixed(1);
  console.log(`${level.id.padEnd(8)} ${scenes} scenes, ${avg} boxes avg`);
  console.log(`         stack contact: max gap ${worstGap.toExponential(1)}  max overlap ${worstOverlap.toExponential(1)}  (want ~0, |x| < ${TOUCH})`);
  console.log(`         ground seating: max error ${worstGround.toExponential(1)}   deepest sink ${sunk.toExponential(1)}`);
  console.log(`         box pairs sharing space: ${overlaps} (worst ${worstOverlapAnywhere.toExponential(1)})`);
  if (leaners) console.log(`         leaners: ${leanersTouching}/${leaners} touching what they lean on, widest gap ${worstLeanerGap.toExponential(1)}`);

  const ok = worstGap < TOUCH && Math.abs(worstOverlap) < TOUCH && worstGround < TOUCH
    && Math.abs(sunk) < TOUCH && overlaps === 0
    && leanersTouching === leaners;
  console.log(`         ${ok ? 'PASS' : '*** FAIL ***'}\n`);
  if (!ok) process.exitCode = 1;
}

// --- every box must be held up by something -------------------------------
//
// The earlier version of this file asked whether the centre of mass sat
// inside the support's top-face rectangle. That is the area a box *could* be
// held up over, not the area it actually rests on, and a box tilted off that
// face still passes it while touching along a single edge. So the contact
// region is measured here instead, by sampling each box's surface and keeping
// the points that touch something.
//
// Which bodies touch, and which way each can push, come from the separating
// axis — exactly, with no sampling. That matters now that contacts are solved
// to touch rather than overlap: a plank meeting a box along one edge has a
// contact of zero area, and no surface grid fine enough to be worth running
// would reliably land a sample on it.
//
// Pushing up holds the box, sideways braces it, downwards is only weight
// resting on top and holds nothing. Sampling is still used, but only for the
// one case that needs an area rather than a direction: a box resting on a
// single body, where the centre of mass has to sit over the patch it actually
// stands on.
//
// A box passes if it rests on one body with its centre of mass over that
// patch, or if two different bodies hold it — which is what leaning against a
// neighbour means.

const SAMPLE = 14;          // per face axis
const CONTACT_TOL = 2e-4;
const MARGIN = 0.01;        // how far inside the support region the COM must be

function faceSamples(box) {
  const A = axesOf(box), h = [box.size.x/2, box.size.y/2, box.size.z/2];
  const out = [];
  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3, v = (axis + 2) % 3;
    for (const sign of [-1, 1]) {
      for (let i = 0; i < SAMPLE; i++) {
        for (let j = 0; j < SAMPLE; j++) {
          // Borders included: a leaning plank meets the ground along one
          // edge of its end face, and insetting the samples would miss it.
          const a = (i / (SAMPLE - 1) * 2 - 1) * h[u];
          const b = (j / (SAMPLE - 1) * 2 - 1) * h[v];
          const p = box.position.clone()
            .addScaledVector(A[axis], sign * h[axis])
            .addScaledVector(A[u], a)
            .addScaledVector(A[v], b);
          out.push(p);
        }
      }
    }
  }
  return out;
}

const insideBox = (p, b) => {
  const A = axesOf(b), h = [b.size.x/2, b.size.y/2, b.size.z/2];
  const d = new Vector3().subVectors(p, b.position);
  return Math.abs(d.dot(A[0])) <= h[0] + CONTACT_TOL
      && Math.abs(d.dot(A[1])) <= h[1] + CONTACT_TOL
      && Math.abs(d.dot(A[2])) <= h[2] + CONTACT_TOL;
};

function hull(pts) {
  if (pts.length < 3) return pts;
  const s = pts.slice().sort((a, b) => a.x - b.x || a.z - b.z);
  const cross = (o, a, b) => (a.x-o.x)*(b.z-o.z) - (a.z-o.z)*(b.x-o.x);
  const lower = [], upper = [];
  for (const p of s) { while (lower.length>=2 && cross(lower[lower.length-2],lower[lower.length-1],p)<=0) lower.pop(); lower.push(p); }
  for (let i=s.length-1;i>=0;i--) { const p=s[i]; while (upper.length>=2 && cross(upper[upper.length-2],upper[upper.length-1],p)<=0) upper.pop(); upper.push(p); }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

function insideBy(h, p) {
  if (h.length < 3) return -Infinity;
  let worst = Infinity;
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i+1) % h.length];
    const ex = b.x-a.x, ez = b.z-a.z, len = Math.hypot(ex, ez) || 1e-12;
    worst = Math.min(worst, -((p.x-a.x)*ez - (p.z-a.z)*ex) / len);
  }
  return worst;
}

/**
 * Separating axis between two boxes, oriented from `a` towards `b` — the
 * direction `a` can push `b`.
 */
function separationAxis(a, b) {
  const A = axesOf(a), B = axesOf(b);
  const ha = a.size.clone().multiplyScalar(0.5), hb = b.size.clone().multiplyScalar(0.5);
  const d = new Vector3().subVectors(b.position, a.position);

  const candidates = [...A, ...B];
  for (const u of A) for (const v of B) {
    const c = new Vector3().crossVectors(u, v);
    if (c.lengthSq() > 1e-10) candidates.push(c.normalize());
  }

  let distance = -Infinity, axis = new Vector3(0, 1, 0);
  for (const L of candidates) {
    const ra = Math.abs(A[0].dot(L))*ha.x + Math.abs(A[1].dot(L))*ha.y + Math.abs(A[2].dot(L))*ha.z;
    const rb = Math.abs(B[0].dot(L))*hb.x + Math.abs(B[1].dot(L))*hb.y + Math.abs(B[2].dot(L))*hb.z;
    const gap = Math.abs(d.dot(L)) - ra - rb;
    if (gap > distance) { distance = gap; axis = d.dot(L) < 0 ? L.clone().negate() : L.clone(); }
  }
  return { distance, axis };
}

/** @returns {'flat'|'braced'|'unsupported'} */
function classify(box, all, groundY) {
  const bodies = [];

  const onGround = faceSamples(box).some(p => Math.abs(p.y - groundY) <= CONTACT_TOL);
  if (onGround) bodies.push('ground');                     // the ground pushes up

  for (const other of all) {
    if (other === box) continue;
    const { distance, axis } = separationAxis(other, box);
    if (distance > CONTACT_TOL) continue;
    if (axis.y < -0.5) continue;                           // weight resting on top
    bodies.push(other);
  }

  if (!bodies.length) return 'unsupported';
  if (bodies.length >= 2) return 'braced';

  // One body holding it: the centre of mass has to sit over the patch it
  // actually rests on, which is the part of its surface that touches.
  const body = bodies[0];
  const patch = faceSamples(box).filter(p => body === 'ground'
    ? Math.abs(p.y - groundY) <= CONTACT_TOL
    : insideBox(p, body));

  return insideBy(hull(patch), box.position) > MARGIN ? 'flat' : 'unsupported';
}

// The bug this check exists for: a box tipped off the face it rests on
// touches along one edge only. If `classify` cannot see that, it is worthless.
{
  const flat = { size: new Vector3(2,1,2), position: new Vector3(0,0.5,0), quaternion: new Quaternion() };
  const upright = { size: new Vector3(1,1,1), position: new Vector3(0,1.5,0), quaternion: new Quaternion() };
  const tiltAngle = 12 * Math.PI / 180;
  const q = new Quaternion().setFromAxisAngle(new Vector3(0,0,1), tiltAngle);
  const reach = (Math.abs(Math.sin(tiltAngle)) * 0.5) + (Math.abs(Math.cos(tiltAngle)) * 0.5);
  const tipped = { size: new Vector3(1,1,1), position: new Vector3(0, 1 + reach, 0), quaternion: q };

  for (const [name, box, want] of [
    ['box square on a slab', upright, 'flat'],
    ['box tipped 12° on a slab', tipped, 'unsupported'],
  ]) {
    const got = classify(box, [flat, box], 0);
    const ok = got === want;
    console.log(`  support  ${name.padEnd(26)} want ${want.padEnd(12)} got ${got.padEnd(12)} ${ok ? 'ok' : '*** FAIL ***'}`);
    if (!ok) process.exitCode = 1;
  }
  console.log();
}

console.log('support: every box flat on its base or braced against another body\n');

for (const level of LEVELS) {
  const tally = { flat: 0, braced: 0, unsupported: 0 };
  const badKinds = {};
  const scenes = 120;

  for (let seed = 1; seed <= scenes; seed++) {
    const rng = mulberry32(seed * 104729 + level.id.length);
    const { boxes, groundY } = generateStacking(level.id, rng);
    for (const box of boxes) {
      const verdict = classify(box, boxes, groundY);
      tally[verdict]++;
      if (verdict === 'unsupported') badKinds[box.kind] = (badKinds[box.kind] || 0) + 1;
    }
  }

  const ok = tally.unsupported === 0;
  console.log(`${level.id.padEnd(8)} ${scenes} scenes — flat ${tally.flat}, braced ${tally.braced}, unsupported ${tally.unsupported}${
    ok ? '' : ` ${JSON.stringify(badKinds)}`}`);
  console.log(`         ${ok ? 'PASS' : '*** FAIL ***'}`);
  if (!ok) process.exitCode = 1;
}

// Overhanging bases are allowed, but the combined load above each
// contact stays inside that contact, assuming boxes of equal density.
let overhangingScenes = 0;
for (const level of LEVELS) {
  for (let seed = 1; seed <= 300; seed++) {
    const { boxes, leaners } = generateStacking(level.id, mulberry32(seed));
    if (level.id === 'harder') {
      assert.equal(leaners, 0);
      assert.ok(boxes.every(box => box.kind === 'stacked'));
      assert.ok(boxes.length >= 4 && boxes.length <= 6);
    }
    for (const box of boxes.filter(box => box.kind === 'stacked')) {
      assert.ok(box.size.y <= Math.min(box.size.x, box.size.z) * 0.75 + 1e-9);
      if (!box.level) continue;
      const support = boxes.find(other => other.stack === box.stack && other.level === box.level - 1);
      const inverse = support.quaternion.clone().invert();
      let overhang = false;
      for (const x of [-0.5, 0.5]) for (const z of [-0.5, 0.5]) {
        const corner = new Vector3(x * box.size.x, -box.size.y / 2, z * box.size.z)
          .applyQuaternion(box.quaternion).add(box.position).sub(support.position).applyQuaternion(inverse);
        if (Math.abs(corner.x) > support.size.x / 2 + 0.02 ||
            Math.abs(corner.z) > support.size.z / 2 + 0.02) overhang = true;
        assert.ok(Math.abs(corner.y - support.size.y / 2) < 1e-9);
      }
      if (level.id === 'harder' && overhang) overhangingScenes++;
      const load = boxes.filter(other => other.stack === box.stack && other.level >= box.level);
      const centre = new Vector3();
      let mass = 0;
      for (const other of load) {
        const weight = other.size.x * other.size.y * other.size.z;
        centre.addScaledVector(other.position, weight);
        mass += weight;
      }
      centre.divideScalar(mass);
      const supported = centre.clone().sub(support.position).applyQuaternion(inverse);
      assert.ok(Math.abs(supported.x) < support.size.x / 2);
      assert.ok(Math.abs(supported.z) < support.size.z / 2);
      centre.sub(box.position).applyQuaternion(box.quaternion.clone().invert());
      assert.ok(Math.abs(centre.x) < box.size.x / 2);
      assert.ok(Math.abs(centre.z) < box.size.z / 2);
    }
  }
}
assert.ok(overhangingScenes > 300, 'Harder should frequently have visible overhangs');
console.log('Visible overhangs, stable upper loads, carton proportions, and no Harder leaners: PASS');
