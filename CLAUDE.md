# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

An interactive 3D perspective-drawing reference. Three exercises — **Intersecting Forms**, **Box Stacking** and **Object Queue** — share one renderer, one control panel and one set of drawing controls. Vite + Three.js, no framework, no TypeScript.

`README.md` carries the derivations behind the geometry decisions below; this file is the operating manual.

## Commands

```bash
npm run dev          # vite dev server; takes the lowest free port from 5173 up
npm test             # all four geometry suites
npm run build        # production bundle into dist/
npm run preview      # serve the built bundle

node test/stacking.mjs   # one suite on its own (also intersections.mjs, silhouette.mjs, queueing.mjs)
```

Tests are plain node scripts — no runner, no WebGL, no browser. They import `src/*.js` directly, which means nothing under `src/` may touch a browser global at module scope or the suites stop running.

**Only `test/stacking.mjs` and `test/queueing.mjs` actually assert** — they print `PASS` / `*** FAIL ***` per group and set a non-zero exit code. `test/intersections.mjs` and `test/silhouette.mjs` are measurement harnesses: they print numbers you have to read, and exit 0 whatever those numbers say. So `npm test` exiting clean is **not** evidence the intersection or contour geometry is right. Read the output, and compare against the reference values printed alongside each measurement (`want ~0`, `exact contour circle`, `facet inset ~2e-3`, and so on).

### Visual verification

`tools/shot.mjs` drives the real page in headless Chrome (puppeteer-core, `/usr/bin/google-chrome`, SwiftShader). It is how rendering bugs get caught — several shipped past the unit tests and were only visible on screen.

```bash
npx vite --port 5179 --strictPort &     # the harness hardcodes :5179
node tools/shot.mjs out.png "click:#exercise button[data-exercise=stacking]" "wait:1500" \
  "click:#level button[data-level=hardest]" "wait:3000" "click:#fit" "shot:shots/a.png"
```

Actions: `click:<sel>`, `select:<sel>=<val>`, `range:<sel>=<val>`, `wait:<ms>`, `eval:<js>`, `evalfile:<path>`, `shot:<path>`, `drag:<dx>,<dy>`. Pass `-` as the output path to skip the final screenshot. It echoes console messages, page errors and the status line. `window.__app = { viewer, scene }` exists for `eval`/`evalfile` to reach into.

Frame times in these captures are SwiftShader rasterisation, not app cost — measure CPU work separately via `eval` before concluding anything about performance.

## Architecture

### Three exercises, one form pipeline

`FormScene` (`src/app.js`) owns every solid in the scene regardless of exercise. All three exercises funnel through **`FormScene.createForm()`**, which builds the mesh, the static hard-edge lines, the dynamic contour buffer, the construction guides and the intersection curves for one solid. They differ only in two things: how the geometry gets positioned, and where the intersection pairs come from.

* **Intersecting Forms** — `src/placement.js` samples a point on an existing surface, aims a new solid at it, and *verifies* the placement by computing the real intersection curve before committing. It returns the pairs it already computed, so `createForm` does no extra CSG.
* **Box Stacking** — `src/stacking.js` returns `{ size, position, quaternion, kind, stack, level }` records; `FormScene.stack()` bakes each into geometry and asks `intersectAgainstScene()` for pairs. In practice there are none, because stacking boxes only ever touch.
* **Object Queue** — `src/queueing.js` returns `{ size, position, quaternion, index, row, column }` records for **one** form repeated. `FormScene.queue()` builds that form once with `createShape()` and bakes a clone of it per record. Pairs are asked for and are always empty; that call is kept as a tripwire, so a generator regression shows up as curves on screen rather than as forms quietly overlapping.

Adding a fourth exercise means a new generator plus a `start()` entry in the `EXERCISES` map in `src/main.js`. Adding the third needed one renderer change — an optional view angle on `frameScene()` — and nothing else.

### World-baked geometry

**Every solid's transform is applied into its vertices.** Meshes and CSG brushes sit at identity; `form.geometry` is already in world space. This is the load-bearing decision in the codebase:

* edge adjacency, crease classification and contour triangle data are all precomputed in world space at placement time,
* `intersectionCurves()` can assume identity brushes and return world-space polylines directly,
* **solids are static once placed.** There is no move/gizmo path, and adding one means rebuilding `edgeData` and the brush for the moved solid, not just setting `mesh.position`.

### Line rendering: everything is drawn twice

`src/lines.js`. Each line set exists as a pair over one shared geometry: depth-tested at full strength, and again with `depthTest: false` in a washed-out colour. `RENDER_ORDER` is `occluder (0) < hidden (1) < visible (2)`.

The style switch does not change what is drawn, only what shows:

* **x-ray** — the hidden pass is visible; surfaces write depth only (`colorWrite = false`) when shading is at zero.
* **hidden-line** — the hidden pass is hidden; surfaces paint the background colour and erase occluded lines.

**Hidden colours are opaque blends toward the background, never translucent.** A transparent material lands in Three's transparent queue, which is drawn *after* all opaque objects regardless of `renderOrder` — the washed-out pass would then paint over the full-strength one. Keep both passes opaque.

Contour lines change every time the camera moves. They are written into a **pre-allocated** `LineSegmentsGeometry` buffer and published by setting `geometry.instanceCount`; calling `setPositions()` per frame would reallocate instanced attributes every frame instead.

### Intersection curves

`src/intersections.js`. `A ∩ B` is evaluated with material groups on, so result triangles stay tagged with which parent surface they came from. The curve is the **boundary of the A-patch** — edges used by exactly one A-triangle. No seam heuristics.

`evaluator.consolidateGroups` and `evaluator.removeUnusedMaterials` **must both stay false**. Consolidation merges A's and B's groups because both brushes carry the same material type, and material pruning renumbers them; either one destroys the tagging the whole approach rests on.

CSG output is not tidy: coincident-face cases leave T-junctions and micro-fragments. The chainer picks the most direction-preserving continuation at a junction, and branches under 6% of the longest are dropped as noise.

### Contours

`src/silhouette.js`. A sphere has no fixed edges, so its outline is re-derived whenever the eye moves, by marching triangles over `f(v) = n(v) · (eye − v)`. Vertex normals are averaged only across smooth edges so creases stay crisp; a vertex with no well-defined normal (a cone apex) is pinned to `f = 0`, since such a point is on the silhouette from every viewpoint.

Walking whole mesh edges instead — the usual front-face/back-face test — gives an outline that zigzags around the true contour by ~10% in arc length. Marching brings that to 0.23%, which is the difference between a clean circle and a visibly wobbly one at drawing line weights.

### Box stacking: two invariants

`src/stacking.js` enforces both, and `test/stacking.mjs` asserts both. Do not weaken either.

1. **A box either sits flat on what is below it, or leans against a neighbour.** Tilting a box off the face it rests on reduces the contact to one edge — zero area for the centre of mass to sit over, so it could only topple. Tilt therefore has to earn a second contact: a plank is stood on the ground and slid until it meets a tower. If it reaches nothing, or only an overhang pushing *down*, it is discarded rather than emitted.
2. **No two boxes ever share space.** Contacts are solved to touch exactly, and the searches converge from the clear side so rounding leaves a hair of daylight, never an overlap. A stacking scene has no intersection curves at all — that is what distinguishes the exercise.

Boxes are seated on a *support plane* (the top face below, or the ground) and solved from it. Working in the support's own frame is what makes the levels fall out: a yaw of zero means "parallel to the box below", so **Easier** keeps a tower square by never turning anything.

### Object queue: one invariant, and a levelled camera

`src/queueing.js`. **No two forms ever share space**, and `test/queueing.mjs` asserts it. The way that is made exact is worth understanding before changing anything here.

An arrangement is a **one-parameter family**. Everything that gives it its shape — the bend angle, the spline's control points, the per-form jitter — is drawn from the rng *before* the spacing solve, and `build( scale )` lays that same shape out larger or smaller. Separation is therefore monotone in `scale` and can be solved for by expansion and bisection, converging from the clear side. Draw anything shape-defining inside `build` and the arrangement changes under the solver, which then has nothing to converge on.

The same rule is why a bent sheet's curvature is re-derived from its current reach on every attempt rather than being a fixed radius: `sag` is the edge's stand-off as a *fraction* of the reach to it, which is scale-invariant.

Do not space forms by centre distance. Evenly spaced centres along a bend close up on the inside of the turn — that is the bug the solver exists to prevent, and `test/queueing.mjs` carries it as a known-answer case.

Forms carry `THIN_AXIS[ arrangement ]`: a slab is sliced across the run in a queue and faces out of the sheet in a matrix. Only `boxProportions` is re-oriented for it — a cone or a pyramid has an axis it stands on.

**This exercise levels the camera, and it is the only one that does.** The horizon is the ground plane's vanishing line, so it sits at eye height; the other exercises pitch down and eye level ends up above everything in the scene. Here the arrangement is centred on the origin and framed at a pitch of zero, which puts eye level through the middle of it — which is the entire point of the exercise. Two consequences:

* `frameScene( box, view )` takes `{ pitch, azimuth }`, filling in whatever is missing from where the camera already is. Passing nothing keeps the angle the user orbited to, which is what the other exercises and **Fit view** do.
* Because `frameScene` reuses the current direction, the levelled camera **leaks into the other exercises** unless it is handed back. `setExercise()` restores `viewer.defaultPitch` on the way out. Remove that and switching away from the queue leaves stacking with a flat camera and an edge-on ground grid.

Forms float rather than resting on the ground, so `groundLevel` is left `null` and the grid finds its own level below them.

### UI state

`src/main.js`. **The markup is the single source of truth for initial state.** Which line style, level and palette start active, and every slider's initial value, are read out of `index.html` at startup — `selectMode()`, `bindSlider()` and `bindCheck()` all call their handler once on load. Changing a default is a one-line edit in the markup. Do not also hardcode it in a module; that pair drifted once already and lit a button whose mode the renderer was not in.

Generators take an `rng` parameter (`Math.random` by default) so tests can seed them.

## Non-obvious constraints

These all cost real debugging time; changing them will reintroduce the bug named.

| | |
| --- | --- |
| Surfaces carry `polygonOffset` and the camera near plane is `0.25`, far `250` | An intersection curve lies on *both* solids at once. Loosen either and curves stipple in hidden-line mode. |
| Coplanarity epsilon in `silhouette.js` is `1e-5`, not `1e-9` | Baking a rotation into vertices is float32; a tighter epsilon calls flat box faces curved and draws spurious contour lines across them at grazing angles. |
| Three 0.186 removed `PCFSoftShadowMap` | It warns and silently downgrades. Use `PCFShadowMap`. |
| `renderer.getDrawingBufferSize()` needs a `Vector2` | An object literal throws and blanks the page. |
| Only faces turned toward the light are shadow-tested (`src/surface.js`) | Testing faces already turned away produces streaky self-shadow acne along the terminator. |
| The default camera pitch is below half the field of view | The horizon is the ground plane's vanishing line; pitch down further and eye level slides off the top of the frame. |
| `Quaternion.angleTo` bottoms out around `3e-8` | `acos` is ill-conditioned at zero, so bit-identical orientations do not compare equal below that. `test/queueing.mjs` compares components where it means identity. |
| Shading's lit end is pinned to the background colour | That is what makes surface tone `0` *exactly* the flat fill rather than approximately it. Themes on a dark ground name their own `shadeColor`, since mixing toward the ink would make shaded faces lighter and invert the read. |

## When a test passes but the render is wrong

This has happened more than once, and the pattern is worth recognising: the assertion measured something adjacent to the property that mattered. The stacking support check originally asked whether the centre of mass sat inside the support's top-face *rectangle* — the area a box *could* be held over, not the area it *rests* on — so boxes balanced on a single edge passed it for weeks.

When fixing a geometry bug, add a known-answer case that fails before the fix. `test/stacking.mjs` carries two (a tipped box must read `unsupported`, a square one `flat`), `test/queueing.mjs` carries an arc spaced by centre distance that must read as overlapping, and `test/intersections.mjs` asserts seam points lie on both parent surfaces. A suite that cannot demonstrate it detects the bug is not evidence the bug is gone.
