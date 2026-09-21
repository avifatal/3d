# Intersecting Forms

An interactive 3D reference for practising **perspective drawing of intersecting forms**.
Add simple solids to a scene; each new one is placed so that it physically cuts into a
solid already there, and the exact curve where the two surfaces meet is computed and
drawn as the emphasised line.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # headless geometry checks, no browser needed
npm run build    # production bundle into dist/
```

## Using it

| Control | |
| --- | --- |
| **Shape** + **Add** | Box, box with variable proportions, sphere, cone, pyramid |
| **New scene** / **Undo** / **Clear** / **Fit view** | `N` · `Z` · — · `F` |
| **Line style** | X-ray ↔ hidden-line (`X`) |
| **Shading** | surface tone, cast shadow, light direction and height |
| **Show** | intersection curves, construction guides, ground grid, curve weight |
| **Palette** | paper or blueprint |

Drag to orbit, scroll to zoom, right-drag or two fingers to pan.

## How it works

### Intersection curves

A boolean `A ∩ B` produces a solid whose surface is two patches: triangles carved from
A's surface and triangles carved from B's. The curve where the originals meet is exactly
the border between those patches. So rather than guessing which result edges are seams,
`src/intersections.js` tags every result triangle with its source brush (via material
groups, with group consolidation switched off so the two sources stay distinguishable)
and takes the boundary of the A-patch — the edges used by exactly one A-triangle.

That boundary is then walked into ordered polylines. CSG output is not a tidy set of
disjoint loops: coincident-face cases leave T-junctions and micro-fragments, so the
walker picks the most direction-preserving continuation at a junction and fragments
under 6% of the longest branch are discarded as noise.

A box driven through another box yields two separate loops — entry and exit — which is
exactly what you want to see when learning where a form enters and leaves another.

### Shading

A pure line drawing gives an intersection curve nothing to read against — it
competes with every other line on screen. So the surfaces carry an optional tone,
and the forms cast real shadows, which restates the depth ordering without adding
any more lines.

`src/surface.js` is a hand-written material rather than one of three's lit ones,
for two reasons. The lit end of its ramp is pinned to the paper colour, so turning
the tone up only ever darkens and never blows out past the background — which
means **surface tone at 0 is exactly the old flat fill**, and the slider moves
smoothly away from it. And the ramp direction is per-theme: mixing toward the ink
would make shaded faces *lighter* on a dark ground and invert the read, so
blueprint names its own shade colour instead.

Lambert is wrapped just past the terminator. A full wrap is too soft — the
hemisphere you can actually see spans only a third of the ramp, so the form barely
turns. Only faces turned toward the light are shadow-tested; a face already
pointing away is darkened by the lambert term anyway, and testing it as well is
what produces streaky self-shadow acne along the terminator.

### Lines, not shading

Nothing is shaded. Each form contributes:

* **hard edges** — creases above 18°, plus shell boundaries. Fixed, computed once.
* **contours** — a sphere has no fixed edges at all, so its outline is re-derived every
  time the camera moves. `src/silhouette.js` marches triangles over
  `f(v) = n(v) · (eye − v)` and connects the zero crossings. Normals are averaged only
  across smooth edges so creases stay crisp, and a vertex with no well-defined normal —
  a cone's apex — is pinned to `f = 0`, since such a point is on the silhouette from
  every viewpoint and would otherwise render as a blunted tip.

  Walking whole mesh edges instead (the usual front-face/back-face test) gives an
  outline that zigzags around the true contour by ~10% in arc length; marching brings
  that to 0.23%, which matters at drawing line weights.

Every line is drawn twice: depth-tested at full strength, and again with depth testing
off in a washed-out colour. Hidden portions are therefore always available, and the
style switch just chooses whether to show that second pass (x-ray) or to let the
background-coloured occluder meshes paint them out (hidden-line).

### Placement

A random transform almost never makes a useful exercise — forms miss, graze, or swallow
each other. `src/placement.js` samples a point on an existing surface (area-weighted),
aims the new form at it, pushes it in to a random depth, gives it a uniformly random
rotation, and then **verifies the result**: the real intersection curve is computed and
the placement is rejected unless a curve exists, is long enough to draw, and the overlap
is between 3.5% and 60% of the smaller solid's volume. Near-total containment is
rejected outright — it produces no visible seam at all. Candidates are scored on curve
length and how close the overlap is to the ideal, with a bonus for cutting two forms at
once; a merely-valid placement is only accepted once the good ones have had their turn.

## Layout

```
src/geomutil.js      vertex welding, polyline chaining
src/intersections.js CSG intersection curve extraction
src/silhouette.js    hard edges + view-dependent contours
src/shapes.js        the five forms and their construction guides
src/placement.js     surface sampling and validated placement
src/lines.js         fat-line plumbing, visible/hidden pass pairs
src/surface.js       surface shading material and light rig
src/viewer.js        renderer, camera, orbit controls, themes
src/app.js           form lifecycle and intersection bookkeeping
src/main.js          control panel wiring
test/                headless geometry checks (node, no WebGL)
tools/shot.mjs       drives the page in headless Chrome to verify rendering
```

`tools/shot.mjs` needs a dev server running and a Chrome at `/usr/bin/google-chrome`:

```bash
node tools/shot.mjs out.png "click:#clear" "select:#shape=sphere" "click:#add" "wait:800"
```
