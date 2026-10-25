# Stage 1.5 — source-constrained Bézier refinement

Baseline main: `7a704b87c2eb21dc6717fce879a5a99333510f94`.
Working branch: `feat/stage-1-5-source-refinement`.
Audit before modifications: AGENTS.md, handoff, Stage 1.4 and source-quality
reports and lib/source_fit/reduce/coverage/corners/planar/geometry metrics read.
VTracer 1.0.0-alpha.4 (`e71343fbcbf469b8a72a255030408a39939162eb`),
visioncortex 0.9.3 and flo_curves 0.8.0 remain unchanged.

Open-source foundations: [VTracer](https://github.com/visioncortex/vtracer),
[visioncortex](https://github.com/visioncortex/visioncortex) and
[flo_curves](https://github.com/Logicalshift/flo_curves). Existing MIT/Apache
attribution remains in the repository; no commercial algorithm implementation
or new optimization dependency is imported.

Stage 1.4 WASM snapshot is preserved in ignored benchmark-results/stage15.
Its source sampling aborts at 8192 visited pixels; sparse recovery requires an
ellipse-like outline and disables general proposals. Baseline-relative reduction
cannot repair large initialization errors. The existing source loss is quantized
to sixteenth-pixel coverage steps. An experimental stage will reuse upstream
raw contours/corner fitting, validate directly against original two-color source
evidence, refine local handles and retain all original fallbacks. No thresholds
in the conservative reducer or graph topology validators will be loosened.



## Status and promotion decision

Primary cubic/wave-1024 reconstruction and final-output geometry gates are
measured separately from build/regression success. The pass is experimental,
**disabled by default**, exposed as `Refinement sumber · uji`. Auto does not
silently change. Full requested input coverage remains PARTIAL: clipped shapes,
uncertain/compound contours, source-alpha refinement and low-resolution acute
caps are not universally solved. No Vector Magic equivalence is claimed.

Merge/promotion requires the explicit source geometry gate as well as CI. A
smaller SVG or passing build is not an acceptance substitute. GitHub results
and final integration decision are recorded at the end after remote verification.

## Confirmed root causes

1. The 1024 cubic baseline maximum lies on an over-bulging fitted S-curve near
   (725.41,571.05), not just the acute tip. Wave's maximum is near
   (578.13,652.67). The unchanged upstream masks support much closer curves:
   replacing geometry without changing a single label materially reduces error.
   These bulk failures are fitting initialization/handle problems, not missing
   faces. This does not prove segmentation is correct for arbitrary images.
2. The old 8192-visited-pixel source budget aborts on long dense boundaries.
   Stage 1.4's distributed retry is deliberately ellipse-only. General curves
   therefore keep the upstream initialization, followed by a reducer whose
   <=0.12px baseline constraint correctly refuses to move them by several pixels.
3. The old 4x4 occupancy score changes in 1/16 coverage steps. Small subpixel
   adjustments can leave its prediction unchanged. Simply increasing a smoothing
   parameter or the reducer's epsilon addresses neither cause.
4. Short reverse-handled spline spans form an ill-conditioned cap at a sharp
   endpoint. Initial experiments improved image loss but introduced an extra
   wave corner. Final serialized corner precision exposed it.
5. The cubic's true acute endpoint is (928,320) at 1024px, with roughly a
   six-degree interior angle. Its thresholded mask has a raster cap below that
   point. Very short support windows can see two parallel pixel columns instead
   of converging arms. Source-only larger scales, conservative source-supported
   corner proposals and local common-anchor refinement are needed; relaxing the
   global mask drift checker is not justified.

## Reused foundation and implementation

VTracer remains the only tracer. Its PixelFitter supplies raw contour support;
its existing region fitter supplies the baseline. Stage 1.3 multiscale corners
and the same flo_curves Schneider fitter initialize a better hypothesis.
The source path partitions existing contours into <=192-point fitting chunks,
with one tangent estimate reused on both sides of a smooth chunk join. No
new segmentation, labeler, planar graph, third-party dependency or upstream
source replacement is introduced.

For source-only long crack chains, tangent scales are 6/12/24 lattice steps;
ordinary Stage 1.3 detection keeps 3/6/10. Stable strong turns can propose a
support-line intersection up to 4px away, but its proposed position is clamped
within 1.2px of its raw vertex. This is candidate generation, not permission to
export it: the existing mask drift/winding/collision validators still apply.
Confirmed nearby output corner positions are reused when initializing the new
fit. Every meaningful change is checked again after actual SVG serialization.

The baseline used for source scoring includes its existing quantization and
coverage correction, respecting previously protected Stage 1.3 models. Rejected
proposals retain the previous contour. The later Stage 1.4 node reducer is still
an independent, conservative pass with its unchanged tolerances.

## Coverage evaluator and convergence

The new evaluator integrates the intersection of a flattened closed contour
with each sampled pixel. For a directed boundary segment, clip its y-range to
that pixel and integrate clamp(x(y)-pixel_x,0,1) analytically. Sum directed
contributions using Green's theorem. A piecewise quadratic antiderivative of
clamp supplies a continuous response to subpixel x/y movement.

This is **exact area for the approximating polygon**, not exact integration of
an arbitrary cubic. Adaptive De Casteljau flattening bounds the control-polygon
flatness. Ranking uses 0.02px, local handle search 0.01px, and final acceptance
0.002px. Only sampled boundary rows are indexed; no interior image supersampling
or differentiable/GPU framework is added.

Independent convergence example: a unit-square cubic whose exact enclosed area
is 0.6 (`M0 0 C1 0 1 1 0 1 Z`). The Rust evaluator, occupancy grids, analytic
integral and high-resolution libvips raster are actually compared by
`source-coverage-benchmark.mjs`.

| Method | Predicted area | Absolute error vs 0.6 |
| --- | ---: | ---: |
| 4x4 occupancy | 0.625000000 | 0.025000000 |
| 8x8 occupancy | 0.625000000 | 0.025000000 |
| 16x16 occupancy | 0.601562500 | 0.001562500 |
| 256x256 occupancy | 0.600128174 | 0.000128174 |
| Polygon flatness .04px | 0.584472656 | 0.015527344 |
| .01px | 0.596099854 | 0.003900146 |
| .002px | 0.599023819 | 0.000976181 |
| .0001px | 0.599938966 | 0.000061034 |
| libvips 256x raster, mean pixel coverage | 0.599832871 | 0.000167129 |

This example and analytic continuous-shift/diagonal/concavity native tests verify
sensitivity/convergence, not a universal rasterizer equivalence theorem.

## Objective, source evidence and bounded solver

Original RGBA remains immutable. Distributed raw-boundary sites supply <=8192
local pixels, with extra small patches at reliable corner sites. Local foreground
and background medians estimate A/B, adequate contrast is required and projected
coverage t follows C≈tA+(1−t)B. Inconsistent colors and excessive contamination
reject the evidence. This is an encoded-RGB two-solid-color assumption; it is
not a claim that every transition is antialiasing. Existing color/region semantics
are retained. Partial alpha, JPEG/WebP, Photo and uncertain classes bypass the
new UI route, preserving the existing export behavior.

Source data energy is mean Huber loss (delta 0.2) of predicted pixel coverage
against observed projected coverage. Candidate acceptance also includes a
1e-6-per-cubic complexity penalty. Local search regularizes handle/anchor
movement by 1e-6 times squared displacement. Source gain must exceed 10%, with
an absolute margin 0.00001 and final robust loss <=0.01. Complexity cannot license
worse reconstruction. Bands already below 0.008 retain the stable baseline.

The deterministic sequence is:

1. Reuse upstream raw geometry and bounded source corner/Bézier fitting to repair
   a bad initialization. The raw label map is not modified.
2. Score and validate the hypothesis. Lock ordinary anchors, hard-corner
   partitions and joins. Rank spans by local source error; select at most four.
3. Optimize two handle lengths per selected span on fixed tangent rays using
   steps 0.4/0.15/0.05px, with <=1px movement. This retains tangent direction
   rather than optimizing every XY handle globally.
4. Condition tiny reverse-handled caps (<2px chord) using the following span's
   tangent, without erasing a protected endpoint. The complete candidate still
   needs source improvement and unchanged raw/topology checks.
5. For at most four very acute caps, optimize the common anchor and its adjacent
   handles together. Steps 0.8/0.8/0.8/0.4/0.2/0.1px, both coordinate axes, with
   <=2.5px total displacement from the initialized vertex. Each improving trial
   must pass the existing raw-mask/winding/self-intersection validator. The
   intentional hard turn and C0 closure are retained; other joins are untouched.
6. Quantize to the existing 0.01px lattice and score at high precision. Keep the
   initialized source candidate if later handle/anchor optimization is worse.
   Enforce the final source gain, complexity, corner and displacement gates.

A **separate source-stage** two-sided baseline displacement envelope is
clamp(0.012*image_extent,4,12)px. Its spatial/sample work is bounded. The existing
mask-relative guard remains <=1.5px (tighter on small shapes). Thus a bad old
vector can move by several pixels toward supported raster evidence without
changing the node reducer or globally relaxing raw-contour safety.

## Topology, ownership and rollback

Stacked composition preserves object/layer ordering. Accepted replacements are
recorded with their original paths; after composition they must have identifiable
ownership, pass collision checks against other contours and preserve nested-face
membership. Ambiguous or unmatched ownership fails closed without rewriting unrelated
layers. Unique, identifiable replacements retain their rollback geometry.
The baseline is retained for rollback. New source paths are protected from a
second independent coverage displacement.

Locked planar/intelligent composition invokes refinement once per eligible
**closed cached edge**, then reuses that geometry and its exact reversal. Junction
endpoints/open chains stay unchanged. Global collision repair reverts rejected
proposals and validates final drift before composition. No per-face refinement
is performed on any Mosaic alias. Renderer antialias seams remain distinct from
geometric gaps.

The four organic/thin graph comparisons verify exact shared-edge coincidence,
zero unmatched interior primitives, zero geometric gap/overlap samples and zero
new crossings. This corpus mostly preserves already-good cached edges; it does
not establish improvement for every open/multi-junction boundary. Existing native
holes/islands/T-junction/diagonal tests and new containment rollback tests remain.

## Termination, timing and memory limits

- At most 8 source-support inspections and 4 refinement attempts per trace.
- <=8192 raw points/source pixels per eligible proposal; fitter chunks <=192
  samples, finite Schneider subdivision and four Newton iterations per fit.
- <=128 candidate cubics and at most 4*baseline_cubics+16. No forced node savings.
- <=8192 adaptive evaluator vertices, depth <=18, <=65536 row-index entries;
  finite coordinate/degenerate guards and fail-closed budget exhaustion.
- Two-sided displacement validation <=32768 samples and <=2 million distance
  comparisons. Existing graph/collision work limits remain unchanged.
- Small shapes <=32px extent, compound/uncertain components and unsupported
  clipped boundaries retain baseline geometry. No extra whole-image tracing
  iteration occurs.

All work runs in the existing disposable WASM worker. Warm requests reuse WASM;
cancel/reset terminates it and obsolete results are not published. No uploads,
accounts, GPU service or persistent backend. Solver time is separately exposed;
it excludes source-support gathering and post-composition ownership checking.
Existing fitting time includes these source-stage costs. Stage timing counters
are inclusive and must not be added together indiscriminately.

## Actual production-browser measurements

Desktop Chromium 154, Illustration preset, same input/viewport/profile for both
variants. Baseline disables only source refinement and retains Stage 1.4 node
optimization. An archived pre-change WASM independently verifies 18/18 disabled
native exports byte-for-byte against main `7a704b8`.

Distances below use retained legal vector references, symmetric sampled
point-to-segment distances with <=.002px curve flattening. Max is a sampled worst
distance, not an analytic Hausdorff guarantee. MAE is premultiplied RGBA on 0–255.
Counts include background/mask geometry. Final exported SVG, not an intermediate
candidate, is measured in Chromium and independently in libvips.

| Fixture | Mean boundary old→new px | p95 old→new px | Max old→new px | IoU old→new | MAE old→new |
| --- | ---: | ---: | ---: | ---: | ---: |
| dense-circle-128.png | 0.0294→0.0294 | 0.0487→0.0487 | 0.0511→0.0511 | 0.999313→0.999313 | 0.5390→0.5390 |
| dense-circle-512.png | 0.0235→0.0235 | 0.0457→0.0457 | 0.0466→0.0466 | 0.999750→0.999750 | 0.4885→0.4885 |
| dense-circle-1024.png | 0.0730→0.0730 | 0.1355→0.1355 | 0.1380→0.1380 | 0.999787→0.999787 | 0.4940→0.4940 |
| dense-ellipse-128.png | 0.0287→0.0287 | 0.0492→0.0492 | 0.0506→0.0506 | 0.998721→0.998721 | 0.5807→0.5807 |
| dense-ellipse-512.png | 0.0208→0.0208 | 0.0469→0.0469 | 0.0492→0.0492 | 0.999811→0.999811 | 0.5400→0.5400 |
| dense-ellipse-1024.png | 0.0601→0.0601 | 0.1351→0.1351 | 0.1389→0.1389 | 0.999773→0.999773 | 0.5440→0.5440 |
| cubic-128.png | 0.1155→0.1155 | 0.3531→0.3531 | 3.4235→3.4235 | 0.991147→0.991147 | 0.7258→0.7258 |
| cubic-512.png | 0.1022→0.1022 | 0.3939→0.3939 | 3.3850→3.3850 | 0.998083→0.998083 | 0.5688→0.5688 |
| cubic-1024.png | 0.7273→0.0918 | 5.8966→0.3711 | 9.1359→1.5615 | 0.994350→0.999281 | 0.7219→0.5402 |
| organic-128.png | 0.2972→0.2972 | 0.9049→0.9049 | 1.5473→1.5473 | 0.988943→0.988943 | 1.0626→1.0626 |
| organic-512.png | 0.2755→0.2755 | 0.7046→0.7046 | 1.3271→1.3271 | 0.997101→0.997101 | 0.5237→0.5237 |
| organic-1024.png | 0.1731→0.1731 | 0.5288→0.5288 | 1.3082→1.3082 | 0.999080→0.999080 | 0.4175→0.4175 |
| rounded-128.png | 0.1852→0.1852 | 0.7179→0.7179 | 0.7477→0.7477 | 0.993384→0.993384 | 0.9040→0.9040 |
| rounded-512.png | 0.1002→0.1002 | 0.4314→0.4314 | 0.6231→0.6231 | 0.998772→0.998772 | 0.3697→0.3697 |
| rounded-1024.png | 0.1176→0.1176 | 0.5043→0.5043 | 0.8114→0.8114 | 0.999548→0.999548 | 0.3474→0.3474 |
| wave-128.png | 0.1111→0.1111 | 0.2829→0.2829 | 1.5697→1.5697 | 0.990146→0.990146 | 0.7548→0.7548 |
| wave-512.png | 0.4590→0.0855 | 2.5768→0.2968 | 3.9465→1.0000 | 0.990799→0.998359 | 0.8276→0.5681 |
| wave-1024.png | 0.6182→0.0794 | 2.7099→0.2985 | 4.6725→1.0000 | 0.994290→0.999274 | 0.7295→0.5392 |

### Structure, source loss and cost

| Fixture / profile | Anchors old→new | Cubics old→new | Paths | SVG bytes old→new | Trace ms old→new | Source solver ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| dense-circle-128.png / auto | 8→8 | 4→4 | 2 | 325→325 | 103.6→29.3 | 0.0 |
| dense-circle-512.png / auto | 8→8 | 4→4 | 2 | 333→333 | 140.1→173.3 | 0.0 |
| dense-circle-1024.png / auto | 8→8 | 4→4 | 2 | 355→355 | 486.0→527.7 | 0.0 |
| dense-ellipse-128.png / auto | 8→8 | 4→4 | 2 | 327→327 | 26.4→24.0 | 0.0 |
| dense-ellipse-512.png / auto | 8→8 | 4→4 | 2 | 333→333 | 141.0→129.4 | 0.0 |
| dense-ellipse-1024.png / auto | 8→8 | 4→4 | 2 | 355→355 | 409.4→427.8 | 0.0 |
| cubic-128.png / auto | 18→18 | 12→12 | 2 | 562→562 | 30.9→27.1 | 1.0 |
| cubic-512.png / auto | 38→38 | 31→31 | 2 | 1059→1059 | 160.6→170.7 | 0.9 |
| cubic-1024.png / auto | 31→73 | 24→66 | 2 | 959→2108 | 380.8→713.4 | 267.2 |
| organic-128.png / auto | 23→23 | 15→15 | 2 | 693→693 | 15.0→14.2 | 0.0 |
| organic-512.png / auto | 46→46 | 38→38 | 2 | 1384→1384 | 123.7→118.4 | 0.0 |
| organic-1024.png / auto | 96→96 | 80→80 | 2 | 2709→2709 | 433.3→444.3 | 0.0 |
| rounded-128.png / auto | 38→38 | 29→29 | 2 | 1232→1232 | 66.1→65.1 | 0.0 |
| rounded-512.png / auto | 46→46 | 32→32 | 2 | 1402→1402 | 213.5→212.3 | 0.0 |
| rounded-1024.png / auto | 107→107 | 72→72 | 2 | 2453→2453 | 479.9→452.4 | 0.0 |
| wave-128.png / auto | 27→27 | 20→20 | 2 | 791→791 | 59.7→44.8 | 0.6 |
| wave-512.png / auto | 45→27 | 39→20 | 2 | 1351→856 | 172.7→309.5 | 169.0 |
| wave-1024.png / auto | 32→57 | 26→50 | 2 | 1046→1768 | 379.0→597.5 | 153.4 |
| corners/square-128.png / auto | 8→8 | 0→0 | 2 | 214→214 | 19.0→19.8 | 0.0 |
| corners/triangle-128.png / auto | 7→7 | 0→0 | 2 | 211→211 | 35.4→44.5 | 0.0 |
| corners/star-128.png / auto | 14→14 | 0→0 | 2 | 285→285 | 121.2→121.6 | 0.0 |
| corners/hair-128.png / auto | 41→41 | 35→35 | 2 | 1166→1166 | 29.5→48.5 | 9.9 |
| corners/mixed-128.png / auto | 13→13 | 6→6 | 2 | 399→399 | 22.5→25.5 | 0.2 |
| shared-edge/organic.png / auto | 36→36 | 28→28 | 4 | 1042→1042 | 47.1→71.2 | 0.3 |
| shared-edge/organic.png / planar | 276→276 | 142→142 | 5 | 8023→8023 | 81.5→89.5 | 8.0 |
| shared-edge/organic.png / intelligent | 68→68 | 60→60 | 5 | 3339→3339 | 78.5→88.3 | 0.3 |
| shared-edge/thin.png / auto | 12→12 | 0→0 | 2 | 234→234 | 22.0→23.6 | 0.0 |
| shared-edge/thin.png / planar | 20→20 | 0→0 | 2 | 311→311 | 11.4→14.4 | 0.1 |
| shared-edge/thin.png / intelligent | 24→24 | 6→6 | 2 | 617→617 | 22.6→25.9 | 0.1 |
| shared-edge/rings.png / auto | 16→16 | 12→12 | 4 | 604→604 | 43.6→42.3 | 0.0 |
| shared-edge/curve.jpg / auto | 145→145 | 70→70 | 22 | 3055→3055 | 56.0→49.8 | 0.0 |
| shared-edge/curve.webp / auto | 74→74 | 42→42 | 10 | 1656→1656 | 33.8→29.1 | 0.0 |
| stage12/cat-128-blended.png / auto | 164→164 | 126→126 | 13 | 4328→4328 | 18.1→13.9 | 0.0 |
| quality/cat-128-partial.png / auto | 273→273 | 41→41 | 13 | 3257→3257 | 50.1→56.1 | 0.0 |
| quality/cat-512-opaque.png / auto | 100→100 | 92→92 | 5 | 3039→3039 | 229.1→350.2 | 82.7 |

More anchors on corrected 1024px curves are an explicit cost of repairing shape,
not an optimization failure disguised by byte reduction. Complexity remains
bounded. Most geometric improvement comes from source-validated reinitialization;
local parameter refinement supplies an additional measured improvement:

| Fixture | Baseline source loss | Initialized source loss | Refined source loss | Evaluations | Actual SVG old/new max displacement px |
| --- | ---: | ---: | ---: | ---: | ---: |
| curve-optimization/cubic-1024.png | 0.02840639 | 0.00509316 | 0.00504485 | 189 | 9.5889 |
| curve-optimization/wave-512.png | 0.02834654 | 0.00375251 | 0.00353279 | 102 | 3.9465 |
| curve-optimization/wave-1024.png | 0.04915915 | 0.00445789 | 0.00439934 | 137 | 4.3885 |

Loss diagnostics aggregate accepted per-contour proposals before later conservative
node reduction; they are not a substitute for the final SVG/raster measurements.
The independent exported geometry table supplies that proof.

### Final-output corner accuracy

One-to-one matching to actual SVG reference corners within 2px; tangent breaks
are measured on serialized output, not merely detector logs.

| Fixture | Precision old→new | Recall old→new | Matched position error old→new px |
| --- | ---: | ---: | ---: |
| curve-optimization/cubic-128.png | 1.0000→1.0000 | 0.6667→0.6667 | 0.0000→0.0000 |
| curve-optimization/cubic-512.png | 1.0000→1.0000 | 0.6667→0.6667 | 0.0000→0.0000 |
| curve-optimization/cubic-1024.png | 0.5000→1.0000 | 0.6667→1.0000 | 0.0000→0.5417 |
| curve-optimization/organic-128.png | 1.0000→1.0000 | 0.3333→0.3333 | 1.4142→1.4142 |
| curve-optimization/organic-512.png | 1.0000→1.0000 | 0.6667→0.6667 | 1.4142→1.4142 |
| curve-optimization/organic-1024.png | 1.0000→1.0000 | 0.6667→0.6667 | 1.4142→1.4142 |
| curve-optimization/wave-128.png | 0.2000→0.2000 | 0.6667→0.6667 | 0.0000→0.0000 |
| curve-optimization/wave-512.png | 0.4286→1.0000 | 1.0000→1.0000 | 0.3333→0.3333 |
| curve-optimization/wave-1024.png | 1.0000→1.0000 | 1.0000→1.0000 | 0.3333→0.3333 |

### Cold and warm worker observations

Wave-512, fresh worker for each mode, then two repeated warm conversions. Exactly
one WASM request per worker; cancellation during cubic-1024 refinement and
subsequent transparent/line-art/gradient exports are verified. Photo explicitly
reports the new pass inactive. These are desktop observations, not Android-device
claims or deterministic speed guarantees.

| Mode / run | WASM startup ms | Decode ms | Segmentation ms | Fitting incl. source ms | Source solver ms | Node reducer ms | Export ms | Trace ms | Committed WASM MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline / cold | 24.5 | 26.6 | 46.5 | 85.3 | 0.0 | 3.6 | 1.4 | 179.6 | 10.62 |
| Baseline / warm 1 | 0.0 | 21.2 | 23.3 | 74.2 | 0.0 | 3.6 | 0.4 | 116.8 | 10.62 |
| Baseline / warm 2 | 0.0 | 25.0 | 27.7 | 74.4 | 0.0 | 3.9 | 0.6 | 123.5 | 10.62 |
| Source / cold | 11.8 | 16.8 | 35.1 | 273.3 | 168.4 | 9.6 | 1.0 | 353.9 | 10.62 |
| Source / warm 1 | 0.0 | 12.2 | 17.4 | 155.7 | 73.5 | 7.7 | 0.2 | 204.2 | 10.62 |
| Source / warm 2 | 0.0 | 23.0 | 17.5 | 163.5 | 83.5 | 7.7 | 0.1 | 203.0 | 10.62 |

Committed WASM capacity is a retained high-water heap measure, not live memory,
process RSS or an Android peak guarantee. Reference/coverage sampling and
ownership checks are included in fitting/total time rather than the solver
subset. The pass adds real CPU and can increase SVG bytes. No speedup is claimed.
Physical Android, Illustrator and GUI anchor manipulation remain unverified.
Inkscape 1.4 CLI actually imports and roundtrips cubic-1024, wave-1024, organic
and partial-alpha exports; anchor counts remain editable and PNG reconstruction
gates pass. Partial-alpha uses the unchanged quantized vector masks, not exact
continuous opacity.

## Failed experiments and remaining limitations

- An unbounded raw-contour fit supplied too many samples. Resampling one long
  run to 192 points then violated the unchanged mask drift guard. Source-only
  <=192-point chunks with shared tangent constraints retain adequate support.
- Independent XY handle moves reduced local loss but risked join artifacts.
  Fixed tangent rays and bounded lengths retain smooth direction constraints.
- A low-loss contour with only a suspected missing tip was allowed to refine;
  cubic-512 gained false corners. This experiment was rejected. The retained
  0.008 source-loss eligibility floor preserves that stable baseline.
- Initial source corners produced an extra wave cusp. Final-output matching
  caught it. Source-only scales, confirmed output-corner constraints, cap
  conditioning and source-validated common-anchor refinement address it.
- Initial cubic-1024 correction still left >3px at the acute endpoint and failed
  the <2px primary research gate. More distributed sampling alone did not fix
  that. Extra corner patches and actual anchor/adjacent-handle optimization
  are necessary; the gate remains enforced rather than waived.
- At 1000% the corrected cubic still has visible subpixel ripples. Chunked
  initialization and local fixed-ray handle descent do not yield a globally
  optimal, minimal design curve. The accuracy gain does not establish ideal
  smoothness or Vector Magic equivalence.
- The source solver cannot recover arbitrary clipped/open/junction geometry with
  this closed-region area model. These cases retain baseline geometry.
- Low-resolution acute cubic caps can still exceed 3px sampled reference error;
  average raster loss does not uniquely determine the hidden geometric tip.
  These unchanged failures are explicit; full input coverage is not certified.
- Encoded-RGB two-color evidence is an assumption. Linear-light rasterization,
  compression, gradients, faint features and translucent compositions are not
  universally supported by this new model. Existing paths remain available.
- The existing raw-mask safety envelope limits further extrapolation of extremely
  acute tips. No assertion of exact original-vector recovery or 99.9% universal
  fidelity is justified by the measured fixture gains.

## Tests, quality gates and visual evidence

Rust integration 35 tests, upstream library 31 tests, TypeScript unit 36 tests,
lint/typecheck, WASM release and Vite builds are run. The full browser suite has
21 tests, including 35 new before/after comparisons plus warm reuse, cancellation
and unsupported-route identity checks. Prior source-quality, Stage 1.4 and
transparency gates remain unchanged. The source promotion gate additionally
requires both primary mean errors to improve >=30%, primary max errors >=40%,
primary max <2px and no final-output corner precision/recall regression.
Build/regression success alone cannot satisfy that gate.

The final local full-suite run had 20 passing tests and one existing shared-edge
UI wait timeout (5 seconds waiting for the download link). The unchanged test
passed on isolated rerun in 5.3 seconds total; no timeout or quality threshold
was relaxed. A prior complete run passed all 21 tests. Remote CI must separately
confirm the final committed code; these observations do not conceal the timeout.

Screenshots compare Source Raster | Stage 1.4 Baseline | Source-Refined Candidate
at 100%, 400%, 1000%, identical source-coordinate ROI/scale. High-zoom crops
focus on the baseline's measured worst location. Additional remaining-error
crops and anchor/control overlays expose defects rather than hiding them.
Diagnostic overlays may embed the original raster; actual downloaded output
SVGs are independently checked to have no image, stroke or filter concealment.

Generated exports, images and raw measurements are ignored git artifacts,
retained by CI in `stage-01-evidence`:

- `benchmark-results/stage15/exports/` — actual before/after browser downloads.
- `curve-optimization-cubic-1024.png-1000.png`, corresponding wave image,
  `*-handles.png` — comparisons/actual editable geometry.
- `*-remaining-1000.png` — remaining large-error locations where applicable.
- `production.json`, `evidence.json`, `cold-warm.json`, `coverage.json`,
  `baseline-parity.json`, `inkscape/results.json` — generated observations.

Representative local comparison:

![Source raster, baseline and refined cubic at 1000%](../benchmark-results/stage15/curve-optimization-cubic-1024.png-1000.png)

The image resolves locally/after artifact extraction; raw generated images and
scores are not committed under AGENTS.md. The GitHub workflow artifact is the
portable evidence package.

## Reproduce

```bash
npm run build:wasm
cargo test --manifest-path engine/Cargo.toml --locked
cargo test --manifest-path engine/Cargo.toml --locked -p vtracer --lib
npm run lint && npm run typecheck && npm run test
npm run build
npm run test:e2e
node scripts/corner-benchmark.mjs
node scripts/source-quality-evidence.mjs
node scripts/curve-optimization-evidence.mjs
node scripts/source-refinement-evidence.mjs
node scripts/source-coverage-benchmark.mjs
node scripts/source-refinement-editability.mjs
node scripts/source-refinement-quality-gate.mjs
```

For installed local Chromium set `NEXORA_CHROMIUM_PATH=/usr/bin/chromium` on
browser commands. Do not rebuild dist or clear test results while a benchmark
consumes them. Optional archived-WASM research scripts are
`source-refinement-probe.mjs` and `source-baseline-parity.mjs`; first build the
verified baseline and copy its generated JS/WASM to the ignored stage15
baseline-wasm directory. The archive is not a committed binary or CI dependency.

## Files and review

- `engine/src/inverse.rs`: continuous polygon coverage, robust source objective,
  bounded initialization/parameter refinement, displacement checks, ownership,
  containment rollback, diagnostics and native regressions.
- `engine/src/corners.rs`: source-only bounded fitting and corner proposals;
  existing detector/fitter entry points retain baseline behavior.
- `engine/src/source_fit.rs`: reuse raw masks and local evidence, fair baseline
  reference and protected replacement/rollback paths.
- `engine/src/{lib,planar,reduce}.rs`: isolated experimental prefix, cached shared
  ring integration and reuse of containment; reducer tolerances are unchanged.
- `src/engine/{adapters,types}.ts`, `src/lib/input.ts`, `src/main.tsx`: explicit
  default-off mode, eligibility, actual diagnostics and unsupported-route notice.
- `scripts/curve-geometry-metrics.{mjs,d.mts}`: worst-error locations using the
  existing metric, not a different or more forgiving distance definition.
- `scripts/source-*.mjs`, `tests/e2e/source-refinement.spec.ts`: actual exports,
  absolute references, two rasterizers, editor, resource/lifecycle tests and
  a separate mandatory quality gate.
- Workflow, README and this report: branch CI, artifacts, scope and honest status.

No upstream code/license/dependency, hosting system, upload path or GPU service
is changed. Review checks final exported geometry, not merely solver counters.

## GitHub status

Local experimental geometry gates PASS, including primary maxima <2px and
all final-output corner comparisons. The reviewed patch preserves Auto byte
parity and all original safety thresholds.

Initial source implementation: `e904018279a711c6d72b85774f8fe470d8b766a7`.
[Its GitHub workflow passed](https://github.com/akidwush/vector-magic-bydika/actions/runs/40179572292),
including all 21 browser tests and the explicit source geometry gate.
A final ownership review additionally rejects identical paths in multiple
layers, rather than overwriting all matches on rollback; a dedicated native
regression verifies unrelated layers remain untouched. All 35 native tests,
WASM/Vite rebuilds and 18 baseline byte-parity comparisons pass after this
safety change. Its remote revalidation is pending; main integration waits for
that final commit's CI. Full requested input coverage remains PARTIAL.
