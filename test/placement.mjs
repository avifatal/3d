// Intersecting Forms: every seam that exists is a seam that gets drawn.
//
// The placement search has two jobs that look like one. It decides whether a
// candidate is worth committing — the overlap has to be a real bite rather
// than a shaving or a swallowing — and it hands back the curves that will be
// drawn. Those were the same list, so a form was committed for the sake of one
// good overlap while its other, out-of-band overlaps were dropped on the
// floor: two solids visibly interpenetrating with no line where they meet.
//
// Nothing downstream can notice. `createForm` draws the pairs it is given,
// and the status line counts the same list, so the scene reports two pairs
// and two curves and is self-consistent about a curve that is missing. The
// only way to see it is to recompute the intersections of the committed forms
// from scratch, which is what this does.

import { Box3 } from 'three';
import { intersectionCurves, makeBrush, meshVolume } from '../src/intersections.js';
import { buildSurfaceSampler, findPlacement } from '../src/placement.js';
import { createShape, SHAPES } from '../src/shapes.js';

// deterministic rng so a failure is reproducible
function mulberry32(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// The band findPlacement scores an overlap in; kept here as a literal so the
// suite can report whether it actually exercised the out-of-band case.
const SCORING_BAND = [0.035, 0.60];

const SEEDS = 40;
const FORMS_PER_SCENE = 4;

let placed = 0, drawn = 0, outOfBand = 0, undrawn = 0;
const examples = [];

for (let seed = 1; seed <= SEEDS; seed++) {
  const rng = mulberry32(seed);
  const forms = [];

  for (let n = 0; n < FORMS_PER_SCENE; n++) {
    const shapeId = SHAPES[Math.floor(rng() * SHAPES.length)].id;
    const shape = createShape(shapeId, rng);
    const placement = findPlacement(shape, forms, rng);
    shape.geometry.dispose();
    if (!placement) continue;

    placed++;
    const form = {
      id: n,
      geometry: placement.geometry,
      brush: placement.brush,
      box: placement.box,
      volume: placement.volume,
      radius: shape.radius,
      sampler: buildSurfaceSampler(placement.geometry),
      links: 0,
    };

    // What the scene will draw, exactly as FormScene.createForm() reads it.
    const curved = new Set();
    for (const pair of placement.pairs) {
      curved.add(pair.form.id);
      drawn++;
      if (pair.ratio < SCORING_BAND[0] || pair.ratio > SCORING_BAND[1]) outOfBand++;
      pair.form.links++;
      form.links++;
    }

    // Ground truth, recomputed against every form already committed.
    for (const other of forms) {
      if (!other.box.intersectsBox(form.box)) continue;
      const result = intersectionCurves(form.brush, other.brush);
      if (!result || result.polylines.length === 0) continue;
      if (curved.has(other.id)) continue;

      undrawn++;
      if (examples.length < 6) {
        const ratio = result.volume / Math.min(form.volume, other.volume);
        examples.push(`seed ${seed} form ${n} (${shapeId}) ∩ form ${other.id}: ` +
          `${result.polylines.length} loop(s), length ${result.length.toFixed(2)}, ratio ${ratio.toFixed(3)}`);
      }
    }

    forms.push(form);
  }
}

console.log('placement — every real intersection carries a curve');
console.log(`  ${SEEDS} scenes, ${placed} forms committed, ${drawn} curves drawn, ` +
  `${outOfBand} of them outside the scoring band [${SCORING_BAND.join(', ')}]`);
for (const line of examples) console.log(`  undrawn: ${line}`);

// A sweep that never commits an out-of-band overlap could not have caught the
// bug, so it is not evidence the bug is gone.
const exercised = outOfBand > 0;
const ok = undrawn === 0 && exercised;
console.log(`  ${undrawn} undrawn intersection(s)` + (exercised ? '' : '  — SUITE IS VACUOUS: no out-of-band overlap committed'));
console.log(`  ${ok ? 'PASS' : '*** FAIL ***'}`);
if (!ok) process.exitCode = 1;
