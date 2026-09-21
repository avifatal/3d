# Perspective Forms

An interactive 3D reference for perspective drawing practice. Three exercises share one
renderer and one set of drawing controls:

* **Intersecting Forms** — add simple solids to a scene; each new one is placed so that
  it physically cuts into a solid already there, and the exact curve where the two
  surfaces meet is computed and drawn as the emphasised line.
* **Box Stacking** — randomised arrangements of solid boxes resting on and leaning
  against one another, at three difficulty levels, after the exercise of the same name
  in the BROKENDRAW workbook. Nothing here intersects anything.
* **Object Queue** — one form repeated along a path or over a sheet, at three
  difficulty levels, after the queueing half of the same workbook page. The forms float
  across eye level rather than resting on anything, and the path can bend.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # headless geometry checks, no browser needed
npm run build    # production bundle into dist/
```

## Using it

The panel is split: the top block belongs to whichever exercise is selected, everything
below it is shared and keeps its settings when you switch.

| Control | |
| --- | --- |
| **Exercise** | Intersecting ↔ Box stacking (`E`) |
| *Intersecting:* **Shape** + **Add** | Box, box with variable proportions, sphere, cone, pyramid (`A`) |
| *Stacking:* **Level** | Easier · Harder · Hardest (`1` `2` `3`) |
| *Queue:* **Arrangement** | Queue ↔ Matrix (`Q`) |
| *Queue:* **Level** | Easier · Harder · Hardest (`1` `2` `3`) |
| *Queue:* **Form** | The form that gets repeated, or Random |
| **New scene** / **New arrangement** | `N` |
| **Fit view** / **Undo** / **Clear** | `F` · `Z` · — |
| **Line style** | X-ray ↔ hidden-line (`X`) |
| **Shading** | surface tone, cast shadow, light direction and height |
| **Show** | intersection curves, construction guides, ground grid, horizon line, curve weight |
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

### Box stacking

The generator never places a box by eye. Every box is rested on a *support plane* — the
top face of the box below, or the ground — and its centre is solved from that plane, so
the contact is exact: no gap to fall through, no interpenetration, and the centre of
mass stays over the support so the stack looks like it could stand.

Working in the support's own frame is what makes the levels fall out naturally. A yaw of
zero means "parallel to the box below", so **Easier** keeps a whole tower square simply
by never turning anything, while **Harder** turns each box freely against the one
beneath. **Hardest** budgets a whole scene: several towers, loose boxes on the ground,
and planks leaning against a tower. Everything inside a level is randomised — counts,
proportions, rotations, offsets and positions — so no two arrangements repeat.

Two invariants govern everything here.

**A box is only ever one of two things: it sits flat on what is below it, or it leans
against a neighbour.** Tilting a box away from the face it rests on collapses the
contact to a single edge, which has no area for the centre of mass to sit over, so such
a box could only ever topple — it reads as leaning on thin air. Every tilted box
therefore has to earn a second contact: a plank is stood on the ground and slid towards
a tower until it meets it. If no aim along its whole travel reaches anything, or what it
reaches is an overhang pushing down rather than something holding it up, the plank is
discarded rather than left standing at an angle on nothing.

**And no two boxes ever share space.** Boxes are solid; a stack of them has no
intersections to draw, which is what separates this exercise from the other one. Every
contact is solved to touch exactly, and the searches converge from the clear side, so
rounding can only ever leave a hair of daylight — never an overlap.

One subtlety worth recording: seating a box against the support *plane* only guarantees
it touches that infinite plane. A tilted box's lowest corner can land beyond the edge of
the finite face and leave it hanging, so once the orientation is fixed the box is
lowered along the plane normal until the two solids genuinely meet.

`test/stacking.mjs` checks randomised scenes per level with a separating-axis test:
stack contacts exact to 1e-15, nothing sunk through the ground, **no pair of boxes
anywhere sharing space**, and every leaning plank genuinely reaching what it leans on.
It then checks that each box is held up. Which bodies touch, and which way each can
push, come from the separating axis — exactly, with no sampling, because a plank meeting
a box along one edge has a contact of zero area that no practical surface grid would
land on. Pushing up holds the box, sideways braces it, downwards is only weight resting
on top. Sampling is used for the one case needing an area rather than a direction: a box
resting on a single body, where the centre of mass must sit over the patch it stands on.

An earlier version of that check asked whether the centre of mass sat inside the
support's top-face *rectangle*. That is the area a box could be held up over, not the
area it rests on, and a box tilted off that face passes it while touching along one
edge — which is exactly how unsupported boxes shipped. The file now carries a
known-answer case for a tipped box, so the check cannot quietly stop detecting them.

### Object queue

The workbook calls this "sliced perspective": the forms in a queue are slices cut out of
one longer volume, so they are identical and evenly spaced, and everything that differs
between them on screen is perspective. `src/queueing.js` takes that literally — the form
is built once and every copy is the same solid. Giving them individual proportions would
make it impossible to tell which differences are the drawing and which are the object.

What the levels vary is the **path**: a straight run, a circular arc, then a free curve
through space with each form turned a little off it. A matrix is the same idea over a
sheet, which goes flat, then cylindrical, then saddled. Each form is oriented by the
frame of the path where it sits — local *x* along the tangent, local *y* as close to
world up as being perpendicular allows, which introduces no roll — so a bent queue reads
as a bent volume that was sliced rather than a row of separate things.

**Spacing is solved, not chosen.** A bend is exactly where spacing by eye goes wrong:
forms spaced evenly along an arc close up on the inside of the turn, and the tighter the
bend the worse it gets. So an arrangement is built as a one-parameter family. Everything
that gives it its shape — the bend angle, the spline's control points, the per-form
jitter — is drawn before the solve, and building it at a different scale lays out that
same shape larger or smaller. Separation between the forms then grows with scale and can
be solved for: expand until they are clear, then bisect for the tightest spacing that
still is. Convergence is from the clear side, so rounding can only ever leave a hair
more daylight than asked for, never an overlap.

The curvature of a bent sheet is re-derived from its current reach on every attempt, for
the same reason: "the edge stands this far off the flat, as a fraction of the reach to
it" keeps the shape fixed while the solver stretches it, where a fixed radius would not.

Two smaller decisions are worth recording. A free curve is a random walk with a limited
turn per step, and it is judged on how far it actually gets end to end — a walk that
keeps turning the same way doubles back, and a run that comes back towards the viewer
stacks up behind itself and reads as a heap rather than a queue. And a new arrangement
is framed from *across* its run rather than down it: the run's bearing is the dominant
eigenvector of the positions' horizontal covariance, and the camera is put at a right
angle to it, because a queue pointing at the camera collapses into a single silhouette —
a true view, and a useless one to draw from.

The camera is also **levelled** for this exercise, which none of the others do. The
horizon is the ground plane's vanishing line and therefore sits at eye height; pitch the
camera down and eye level rises above everything in the scene. This exercise is about
how much of a plane is revealed by its distance from that line, so the arrangement is
centred on the origin and viewed from a pitch of zero, which puts eye level exactly
through the middle of it. The forms float for the same reason: resting them on the
ground would put the whole arrangement below the eye line.

`test/queueing.mjs` checks randomised arrangements per level and per shape with its own
separating-axis test, corroborated by walking a grid of points through each form and
asking whether any lands inside another. No two forms share space; the spacing is within
a fraction of a percent of the tightest that keeps them apart; straight runs are evenly
spaced to 1e-15; the chord between neighbours on an arc bisects their two tangents; no
form is rolled or mirrored; and every arrangement is centred. It carries a known-answer
case for the bug the solver exists to prevent — an arc spaced by centre distance, which
must read as overlapping — so the check cannot quietly stop detecting it.

### Horizon

The horizon is not a line in the scene: it is the vanishing line of the ground plane,
where every horizontal direction projects to. `src/horizon.js` finds it exactly by
projecting a ground-parallel direction as a point at infinity, and draws it as a DOM
overlay so it stays a crisp single pixel at any zoom. Note the default camera is
deliberately kept low — pitch down by more than half the field of view and eye level
slides off the top of the frame.

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
src/stacking.js      box stacking: contact solving and the three levels
src/queueing.js      object queue & matrix: path frames and spacing solving
src/horizon.js       eye-level overlay
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
