# Stage 1.4 — bounded curve and node optimization

## Audit recorded before engine changes

Baseline: main `9acd99541c9041051c865eed5d54859bcf77c9c5`.
Working branch: `feat/stage-1-4-curve-optimization`.
VTracer 1.0.0-alpha.4, upstream e71343fbcbf469b8a72a255030408a39939162eb,
visioncortex 0.9.3 and flo_curves 0.8.0 retain their existing licenses.

| Question | Confirmed implementation |
| --- | --- |
| Initial contours | Upstream RegionMask binary components; lattice polylines and shared graph Segment chains. |
| Cubics already present? | FittedGeom::Beziers and VectorDoc PathCmd::CubicTo; this is not a polyline-only engine. |
| Before-fitting simplification | visioncortex Polygon/Spline and mosaic limit_penalties remove staircases. Stage 1.3 adds source-verified models. |
| Corners | Upstream default 60 degrees, disk components 90; Stage 1.3 multiscale protected corners and fixed junctions. |
| Measured error | Stage 1.3 validates source coverage and raw-contour drift; upstream spline FIT_ERROR is not a certified geometric Hausdorff bound. |
| Simplification ownership | Upstream SimplifyCurves runs per cached shared edge in mosaic. Main Auto usually has no general curve pass. Locked planar mode fits/validates a cache and composes afterward. |
| Termination | Pixel/sample/graph budgets exist. SimplifyCurves caps samples per cubic at 512 but not the whole run; flo_curves uses four Newton iterations and error-driven recursive splitting, with no explicit public recursion budget. |
| Intersections | Locked graph has global collision checks and fallbacks. Source models have bounded checks. Independent stacked shapes do not constitute a universal planar subdivision. |
| Nodes vs regions | Both problems exist. No new segmentation/region merge belongs in this stage; path count must remain unchanged by node reduction. |
| Reusable algorithms | Upstream SimplifyCurves, flo_curves Schneider fitting (least squares, chord lengths, Newton reparameterization, error-driven subdivision), cleanup/quantization/writer and existing graph validation. |

Confirmed serialization inefficiency: CleanupPass removes collinear L commands,
but does not turn geometrically straight C commands into L. Background rectangles
therefore spend eight control handles on four straight sides. Existing metric
svgPoints counts serialized endpoints (including a repeated closing endpoint),
not unique editable anchors. Stage 1.4 must distinguish these counts.

Historical/current Stage 1, 1.1, 1.2, shared-edge, 1.3 and source-guided reports were
reviewed. Their alpha, renderer-seam, corner-budget and compression failures remain
regression cases; passing unit tests does not certify visual equivalence.

## Baseline and experiments

Measurements and baseline WASM are generated under benchmark-results/stage14,
not committed. Implementation/acceptance results follow after actual verification.

## Algorithm and error budget

This change adds a bounded optimization layer around upstream geometry, not a
new tracer. No dependency, segmentation preset, color threshold, alpha model,
hosting service or upstream engine version is changed.

1. Preserve the existing source analysis, segmentation and topology. For stacked
   output, optimize at the existing 0.01px export lattice. Cached shared edges
   retain their absolute six-decimal representation.
2. Partition cubic chains at existing protected corners (confidence >=0.5),
   graph endpoints, stable physical-scale tangent discontinuities measured at
   1/2/4px, and substantial straight/curve transitions. Never fit across these
   constraints. Small pixel connectors are not automatically protected corners.
3. Reuse VTracer `SimplifyCurves` when its samples fit the work cap; otherwise
   call the same flo_curves `fit_curve_cubic` implementation on <=192 samples
   spread by arc length over the contour. This is Schneider-style least squares,
   chord-length parameterization, four Newton iterations and error-driven
   recursive subdivision. No second tracing or preset search is performed.
4. Accept a proposal only if it has fewer segments and passes independent
   two-sided distance validation. Cubics are flattened at <=0.002px flatness;
   samples spaced <=epsilon/2 must have target-segment distance
   <=0.75*epsilon-0.004px. The remaining epsilon/4 covers unsampled points via
   the distance function's Lipschitz bound. Parameters on different curves are
   never assumed to correspond. Unsupported loops fail the reverse test.
5. Epsilon is 0.025px for extent <=24px, 0.06px for extent <=256px, otherwise
   0.12px, **relative to the previous fitted vector**, not a promise about the
   unknown original artwork. Very small features receive the tighter budget.
6. New fitted coordinates are rounded to 0.001px **before** validation. Endpoint
   and corner identities are then restored exactly. Shared serialization retains
   six decimal places, identically on both faces. Exactly monotone collinear
   cubics become `L` commands; this removes control handles without moving an
   anchor or crossing a junction. Collinear runs can merge only inside a
   previously partitioned, owned edge/contour.
7. Closed stacked contours additionally preserve winding, parent/child inclusion
   and pass existing collision validation against themselves and other contours.
   Shared candidates are fitted once in the upstream edge cache, checked for raw
   drift and global crossings, and rolled back on failure before face assembly.
   No approximate per-face optimization is allowed afterward.

The source-guided Stage 1.3 ellipse model already produces four cubics. At 1024px,
exhausting its old dense sampling budget prevented it being considered at all.
For already ellipse-like large outlines only, retry using <=512 distributed
boundary sites and the unchanged <=8192 local pixel budget. A cheap all-boundary
radial residual preflight rejects nonelliptic contours before the coverage solver.
The existing alpha, local-color, coverage residual, >5% source-loss improvement,
corner, drift and collision guards still decide acceptance. Generic source fits
and polygon models are **not** enabled from this sparse evidence. This recovers
an existing model where warranted; it does not force organic eyes into ellipses.

## Limits, termination and memory

- At most 64 eligible contour/edge attempts, <=4096 old cubics per chain,
  <=193 upstream / <=192 resampled fit points per partition, <=32768 flattened points, <=200000 validation
  samples per proposal, <=200000 spatial index entries and <=2 million distance
  comparisons per validation. Accumulated sample work stops further proposals
  after 500000 (one final attempt can add <=200001). Numerical/degenerate inputs
  fail closed. Source geometry has its existing separate 8192-pixel work budget.
- The reused recursive fitter has a finite <=193-sample input, four Newton
  iterations per recursive fit and splitting into smaller sample sets. This is
  not an invented claim that recursion depth is four.
- Long diagonal index segments are subdivided before indexing so grid storage
  grows with length, not bounding-box area. Native regression tests cover this
  and off-lattice protected corners, NaN/extreme/repeated samples and bad loops.
- Stacked document optimization skips >128 contours or >65536 commands. Shared
  graph safety fallback stays available; pixel fallback and opacity masks are
  not aggressively compacted. Fragmented regions are not merged in this stage.
- Photo and historical comparison profiles retain their previous policy.
  The UI checkbox disables the new pass and sparse model recovery. A saved
  pre-change WASM replay verifies byte-identical disabled native SVGs for all
  18 new resolution fixtures.
- Existing workers retain WASM between completed jobs; cancel/reset/idle disposal
  still terminates the worker. No online configuration sweep is added.

## Failed experiments and measurement corrections

- One immediate tangent angle protected tiny raster connectors as corners.
  Physical-scale tangents plus Stage 1.3 corner evidence replaced this criterion.
- A 120000-sample validation cap exhausted on large rectangle perimeters before
  useful work. The explicit cap is 200000; exact collinear-locus proofs avoid
  numerical refitting of such runs.
- Rounding and then searching corners with a tiny distance epsilon could miss
  off-grid interior constraints. Constraint identities are now recorded before
  rounding and restored by index; a native test exercises actual rounded fits.
- Fitting an entire difficult organic run often fails the strict geometric check.
  Such proposals are rejected; epsilon was not increased to manufacture savings.
- Sparse source-model attempts on large nonelliptic contours consumed time with
  no benefit. The inexpensive ellipse preflight removes those attempts.
- The historical geometric metric sampled cubic parameter t uniformly, whereas
  an equivalent `L` sampled by length. On `curve.jpg`, replacing exact straight
  cubics by lines changed historical p95 from 6.22117 to 6.24543px although SVG
  locus differed by <1e-12px and decoded reconstruction pixels were identical.
  The corner benchmark now uses uniform arc length on independently flattened
  curves. Existing quality tolerances are unchanged; unit tests cover equivalent
  `C`/`L` loci and an unsupported reverse-direction bulge.
- Transferring millions of scalar RGBA values through Playwright exhausted the
  offline evidence harness's memory. Chromium now computes metrics in its own
  page and returns only measurements. This change affects research tooling,
  not the conversion worker.

## Reproduction and artifact locations

Run from the repository root with the documented Node/Rust tools:

```bash
npm run build:wasm
npm run lint && npm run typecheck && npm run test
cargo test --manifest-path engine/Cargo.toml --locked
cargo test --manifest-path engine/Cargo.toml --locked -p vtracer --lib
npm run build
npm run test:e2e
node scripts/corner-benchmark.mjs
node scripts/source-quality-evidence.mjs
node scripts/curve-optimization-evidence.mjs
node scripts/curve-optimization-editability.mjs
```

For installed local Chromium use `NEXORA_CHROMIUM_PATH=/usr/bin/chromium` on
browser commands. Do not rebuild dist or clear test-results while tests/evidence
consume them. `curve-optimization-fixtures.mjs` regenerates the six CC0 vector
references and their independently rasterized 128/512/1024px PNGs. JPEG/WebP,
alpha, sharp-corner, cat, thin-line, shared-face, noise and gradient regression
fixtures from earlier stages remain in the suite.

Raw observations, downloaded SVGs and screenshots are generated in ignored
`benchmark-results/stage14/` and `test-results/`. They are retained by GitHub CI
in the `stage-01-evidence` artifact; generated benchmark scores are not committed
per AGENTS.md. Copy the old revision's built JS/WASM to
`benchmark-results/stage14/baseline-wasm/` before running
`node scripts/stage14-baseline.mjs` and `node scripts/curve-optimization-research.mjs`
for the offline baseline replay. This optional replay is not a browser proof.

Actual Chromium screenshots are produced at 100%, 400% and 1000%, with identical
source-coordinate crops, target scale, panel viewport and caption heights. At
high zoom a crop avoids allocating a 30000px-wide canvas; it is not a resized
low-zoom screenshot. Every caption includes dimensions, format, preset, engine,
anchor/curve/path counts, bytes, boundary error (where ground truth exists),
and runtime. Separate overlays show editable anchors and control handles.
The diagnostic overlays may embed the source raster; downloaded output SVGs
are separately checked to contain real paths and no embedded image/stroke/filter.

Representative files in the downloadable artifact / local workspace:

- `benchmark-results/stage14/curve-optimization-dense-circle-1024.png-1000.png`
- `benchmark-results/stage14/curve-optimization-dense-ellipse-1024.png-400.png`
- `benchmark-results/stage14/curve-optimization-rounded-512.png-handles.png`
- `benchmark-results/stage14/curve-optimization-cubic-1024.png-1000.png`
- `benchmark-results/stage14/quality-cat-128-partial.png-400.png`
- `benchmark-results/stage14/corners-star-128.png-1000.png`
- `benchmark-results/stage14/evidence.json`, `production.json`, `cold-warm.json`
- `benchmark-results/stage14/inkscape/results.json` plus actual imported/exported files

## Results

Measured 2026-10-25 using actual production dist, desktop Chromium 154, Node
24.19 and Rust 1.99.1. Baseline is the same input/preset/profile with optimization
disabled, verified against the saved main WASM. New engine is VTracer WASM;
fallback exports are separately regression-tested. No Vector Magic output was
available for a licensed side-by-side benchmark.

The following are **unique editable path anchors**, excluding a coincident
closing endpoint, not raw coordinate-pair or control-point counts. Cubics include
implicit `S` commands. Each cubic has two semantic control handles. Counts include
canvas background and, where present, vector opacity-mask paths. Path counts are
unchanged in every pair. A fewer-C result with unchanged anchors may be an exact
line conversion, not anchor reduction.

### Structural measurements — original raster → baseline → optimized

| Fixture / pixels / profile | Anchors old→new | Cubics old→new | Paths | SVG bytes old→new | Trace ms old→new |
| --- | ---: | ---: | ---: | ---: | ---: |
| dense-circle-128.png / auto | 8→8 | 8→4 | 2 | 390→325 | 81.8→41.2 |
| dense-circle-512.png / auto | 8→8 | 8→4 | 2 | 406→333 | 152.2→144.4 |
| dense-circle-1024.png / auto | 56→8 | 56→4 | 2 | 1876→355 | 327.3→450.5 |
| dense-ellipse-128.png / auto | 8→8 | 8→4 | 2 | 392→327 | 27.3→25.0 |
| dense-ellipse-512.png / auto | 8→8 | 8→4 | 2 | 406→333 | 161.4→122.2 |
| dense-ellipse-1024.png / auto | 53→8 | 52→4 | 2 | 1736→355 | 288.8→366.5 |
| cubic-128.png / auto | 18→18 | 18→12 | 2 | 653→562 | 35.1→19.3 |
| cubic-512.png / auto | 38→38 | 38→31 | 2 | 1183→1059 | 124.6→126.8 |
| cubic-1024.png / auto | 36→31 | 35→24 | 2 | 1171→959 | 326.0→326.0 |
| organic-128.png / auto | 23→23 | 23→15 | 2 | 823→693 | 10.9→11.7 |
| organic-512.png / auto | 46→46 | 46→38 | 2 | 1533→1384 | 94.2→94.3 |
| organic-1024.png / auto | 97→96 | 96→80 | 2 | 2972→2709 | 353.1→369.6 |
| rounded-128.png / auto | 45→38 | 44→29 | 2 | 1276→1232 | 14.1→55.6 |
| rounded-512.png / auto | 77→46 | 76→32 | 2 | 2175→1402 | 94.5→183.1 |
| rounded-1024.png / auto | 108→107 | 107→72 | 2 | 2987→2453 | 368.3→423.3 |
| wave-128.png / auto | 27→27 | 27→20 | 2 | 905→791 | 27.1→28.1 |
| wave-512.png / auto | 46→45 | 45→39 | 2 | 1451→1351 | 98.6→96.3 |
| wave-1024.png / auto | 37→32 | 36→26 | 2 | 1257→1046 | 352.4→355.3 |
| square-128.png / auto | 8→8 | 4→0 | 2 | 279→214 | 16.4→16.6 |
| triangle-128.png / auto | 7→7 | 4→0 | 2 | 276→211 | 38.8→35.7 |
| star-128.png / auto | 14→14 | 4→0 | 2 | 350→285 | 110.0→109.5 |
| hair-128.png / auto | 41→41 | 41→35 | 2 | 1256→1166 | 29.2→30.3 |
| mixed-128.png / auto | 13→13 | 13→6 | 2 | 511→399 | 18.9→18.9 |
| shared/organic.png / auto | 36→36 | 33→28 | 4 | 1123→1042 | 38.1→44.4 |
| shared/organic.png / planar | 280→276 | 280→142 | 5 | 11617→8023 | 37.5→64.9 |
| shared/organic.png / intelligent | 68→68 | 68→60 | 5 | 3531→3339 | 50.1→73.7 |
| shared/thin.png / auto | 12→12 | 4→0 | 2 | 299→234 | 24.5→23.3 |
| shared/thin.png / planar | 20→20 | 20→0 | 2 | 751→311 | 13.8→10.9 |
| shared/thin.png / intelligent | 24→24 | 24→6 | 2 | 1033→617 | 19.3→24.4 |
| shared/rings.png / auto | 16→16 | 16→12 | 4 | 669→604 | 41.7→42.7 |
| shared/curve.jpg / auto | 145→145 | 145→70 | 22 | 4137→3055 | 23.0→39.2 |
| shared/curve.webp / auto | 74→74 | 74→42 | 10 | 2126→1656 | 8.3→40.6 |
| cat-128-partial.png / auto | 273→273 | 43→41 | 13 | 3284→3257 | 40.6→40.0 |
| cat-512-opaque.png / auto | 101→100 | 100→92 | 5 | 3172→3039 | 185.7→203.8 |

The 1024px circle's object contour is 48→4 cubics (91.7% reduction); including
the canvas gives 56→8 anchors (85.7%). Ellipse total anchors drop 84.9%.
Rounded-512 total anchors drop 40.3%; its object fitting drops 68→38 cubic-form
segments before exact line serialization. This demonstrates the 25/50/75/90%
research categories without forcing any preset percentage: some inputs cross
75% total and 90% object reduction, others retain almost all required anchors.
For cubic/wave-1024 most saved anchors belong to the frame, not the subject;
they must not be advertised as successful reconstruction of the original cubic.

### Independent geometric ground truth

Distances are in source pixels, symmetric sample-to-segment measurements from
retained vector references, <=0.002px curve flattening and <=0.5px sample spacing.
Mean weights the two directions equally; p95 combines samples. Max is a sampled
worst distance, not an analytic certified Hausdorff bound. The optimizer's own
stricter local bound is relative to baseline geometry; these independent numbers
measure absolute reference error. No universal 99.9% fidelity is inferred.

| Fixture | Mean old→new px | p95 old→new px | Sampled max old→new px | New silhouette IoU (libvips) |
| --- | ---: | ---: | ---: | ---: |
| dense-circle-128.png | 0.0294→0.0294 | 0.0487→0.0487 | 0.0511→0.0511 | 0.999313 |
| dense-circle-512.png | 0.0235→0.0235 | 0.0457→0.0457 | 0.0466→0.0466 | 0.999750 |
| dense-circle-1024.png | 0.2066→0.0730 | 0.6907→0.1355 | 0.9755→0.1380 | 0.999787 |
| dense-ellipse-128.png | 0.0287→0.0287 | 0.0492→0.0492 | 0.0506→0.0506 | 0.998721 |
| dense-ellipse-512.png | 0.0208→0.0208 | 0.0469→0.0469 | 0.0492→0.0492 | 0.999811 |
| dense-ellipse-1024.png | 0.2187→0.0601 | 0.6897→0.1351 | 0.7919→0.1389 | 0.999773 |
| cubic-128.png | 0.1155→0.1155 | 0.3531→0.3531 | 3.4235→3.4235 | 0.991147 |
| cubic-512.png | 0.1022→0.1022 | 0.3939→0.3939 | 3.3850→3.3850 | 0.998083 |
| cubic-1024.png | 0.7273→0.7273 | 5.8945→5.8966 | 9.1260→9.1359 | 0.994350 |
| organic-128.png | 0.2974→0.2972 | 0.9050→0.9049 | 1.5499→1.5473 | 0.988943 |
| organic-512.png | 0.2735→0.2755 | 0.6926→0.7046 | 1.3271→1.3271 | 0.997101 |
| organic-1024.png | 0.1729→0.1731 | 0.5292→0.5288 | 1.2990→1.3082 | 0.999080 |
| rounded-128.png | 0.1799→0.1852 | 0.7163→0.7179 | 0.7500→0.7477 | 0.993384 |
| rounded-512.png | 0.0940→0.1002 | 0.4276→0.4314 | 0.6122→0.6231 | 0.998772 |
| rounded-1024.png | 0.1214→0.1176 | 0.5112→0.5043 | 0.8042→0.8114 | 0.999548 |
| wave-128.png | 0.1112→0.1111 | 0.2829→0.2829 | 1.5697→1.5697 | 0.990146 |
| wave-512.png | 0.4594→0.4590 | 2.5782→2.5768 | 3.9473→3.9465 | 0.990799 |
| wave-1024.png | 0.6187→0.6182 | 2.7151→2.7099 | 4.6675→4.6725 | 0.994290 |

The dense circle mean boundary error improves about 65%; ellipse about 73%.
Circle-1024 maximum radial residual improves 0.9755→0.1380px and center error
0.4593→0px. The axis-normalized ellipse radial metric improves maximum residual
0.7907→0.0938px and bounding-extrema center error 0.4499→0px. The ellipse radial
metric uses min(rx,ry) to scale normalized radius and is not an exact Euclidean
ellipse distance; the independent boundary table above supplies that comparison.
Rounded-512 mean rises by about 0.0062px; this is an explicit bounded tradeoff,
not a claim that all quality metrics improve. Its actual old-to-new boundary max
is 0.0811px. Protected square/triangle/star corner identities are unchanged.

### Topology, features, transparency and editability

All 34 before/after pairs preserve path and closed-subpath counts. The four
additional locked planar/intelligent comparisons (organic and thin fixtures)
have exact paired interior primitives, coincidence 1.0, unmatched primitives 0,
geometric gap samples 0, overlap samples 0 and crossingsAfter 0. Native graph
cases also cover holes, islands, T-junctions and diagonal contact. Planar organic
anchors drop 280→276; intelligent organic remains 68. Renderer hairlines remain
a separately measured SVG rasterization/compositing effect; the stacked Auto
representation is still not a universal shared planar subdivision.

Partial-alpha cat-128 IoU is **0.983604**, unchanged and above the 0.980 gate in
both libvips and Chromium; no alpha regression is hidden by a white background.
Opacity masks remain quantized vector contours, not exact continuous alpha.
Thin lines, eyes/nose ROI retention, source color reconstruction, compressed
JPEG/WebP, true-corner scales and photo/gradient routes pass their existing gates.
JPEG/WebP path fragmentation is retained: 22 and 14 paths respectively on this
fixture. Removing redundant handles is not represented as fixing segmentation.

Inkscape 1.4 CLI actually imported optimized circle-1024, rounded-512,
shared-organic and partial-alpha cat. Plain SVG roundtrips preserve the measured
editable anchors and paths and contain no image; PNG exports meet reconstruction
gates. Inkscape GUI anchor manipulation and Illustrator import were **not tested**.

### Runtime and memory

Single-shot tracing observations above include diagnostics, segmentation,
fitting, refinement, alpha handling and export; the first old run is cold and
JIT/scheduling make these indicative rather than device performance guarantees.
A separate reset/cold + two-warm run benchmark uses rounded-512 with each mode in
its own fresh worker. WASM is fetched exactly once per worker, retained for both
warm runs, then reset/disposed. Measurements below are actual milliseconds:

| Mode / run | WASM startup | Decode | Segmentation | Existing fitting | Refinement incl. optimizer | Optimizer subset | SVG export | Trace total | WASM committed MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline / cold | 10.9 | 20.8 | 39.5 | 95.7 | 2.9 | 0.0 | 1.9 | 175.7 | 7.69 |
| Baseline / warm 1 | 0.0 | 20.0 | 32.9 | 72.2 | 1.2 | 0.0 | 0.9 | 126.8 | 9.75 |
| Baseline / warm 2 | 0.0 | 25.7 | 20.0 | 66.1 | 1.5 | 0.0 | 0.5 | 118.4 | 9.75 |
| Optimized / cold | 14.5 | 20.7 | 46.8 | 76.8 | 104.0 | 101.2 | 2.5 | 260.3 | 7.69 |
| Optimized / warm 1 | 0.0 | 24.8 | 29.6 | 74.6 | 94.1 | 92.9 | 0.4 | 218.7 | 9.75 |
| Optimized / warm 2 | 0.0 | 24.3 | 19.2 | 111.5 | 92.7 | 91.5 | 2.4 | 260.1 | 9.75 |

The optimizer costs real CPU (about 90–100ms on this bounded rounded-512 case);
it is not a speed improvement. The ellipse preflight removes ~100ms of pointless
source-model work on cubic/wave-1024 in earlier experimental runs. Stage timings
are inclusive: postprocess includes fitting/refinement, and optimizer is a subset
of refinement; do not add overlapping counters. Source ellipse work is inside
existing fitting, not the reducer's counter. Contour extraction is part of
upstream segmentation/fitting and is not separately instrumented here.

The reused multi-image worker reached 40.38MiB committed WASM memory for the
1024px suite, equal in paired variants because the heap is retained. Fresh-worker
rounded-512 measurements above grow from 7.69 to 9.75MiB in both modes. This is
committed linear memory/high-water capacity, **not peak live allocations or
browser RSS**. Full peak process memory and physical Android performance remain
unmeasured. Real mobile-layout emulation, worker cancellation and resource
revocation tests pass; they are not physical-device timing evidence.

### Checks and known failures

- Rust integration: **26/26**; upstream VTracer library: **31/31**.
- TypeScript unit tests: **36/36**; lint/typecheck pass.
- WASM release and production Vite build pass.
- Actual production Chromium E2E: **19/19**, including 34 optimization
  comparisons, separate cold/warm reuse, fallback, reset/cancel, input caps,
  transparency, photo/gradients, shared graphs and previous-stage quality gates.
- Independent ground truth, two rasterizers, source-quality evidence and four
  Inkscape CLI roundtrips pass their unchanged regression gates.
- Initial full browser run had one ambiguous-checkbox selector failure. The
  downscaling consent test now explicitly selects its consent checkbox; a clean
  19-test run passes. An apparent compressed-art geometry regression was a
  parameter-sampling bias, corrected and unit-tested as described above.

**Full visual acceptance remains PARTIAL / NOT CERTIFIED.** Specifically:

- **FAIL / unresolved:** cubic-1024 still has ~9.14px sampled worst source error
  (baseline ~9.13px), and wave-1024 ~4.67px. A mathematically simple reference
  does not yet always reconstruct with few accurate subject segments. These
  absolute fidelity failures are not waived by lower node count or passing
  infrastructure/regression tests.
- **NOT ACHIEVED globally:** organic, hair and compressed cases often retain
  subject anchors; rounded-1024 rejects approximate merges. There is no proof
  of a globally minimum number of cubic segments.
- Existing pixel fallback can remain dense, and region fragmentation/partial
  opacity masks still contribute many editable nodes. They are not merged or
  independently smoothed to manufacture a count win.
- No universal no-crossing guarantee is asserted for arbitrary stacked upstream
  input; new accepted proposals use bounded collision checks and rollback.
- A renderer may display compositing seams even when paired geometry is exact.
  No overlapping-face/stroke trick was added to hide this.
- The owner's original problematic raster is not available in this workspace;
  its result is unverified. No Vector Magic quality equivalence, universal
  99.9% fidelity, Android timing or Illustrator compatibility is claimed.

Integrate the proven bounded improvements while retaining the opt-out and the
existing safe fallbacks; do not mark every Stage 1.4 research objective complete.
Next priority is source-constrained fitting of mixed long lines/cubics with
corner-location refinement at high resolution, then efficient local refitting
of rejected organic intervals. Region fragmentation requires a separate
noise-aware segmentation investigation, not higher geometric epsilon.

## Files changed and review

- `engine/src/reduce.rs`: upstream fitting reuse, physical-scale partitioning,
  exact constraints, independent distance budgets, topology checks, exact line
  canonicalization and native degeneracy/protection regressions.
- `engine/src/{lib,planar,source_fit}.rs`: native opt-in prefix, shared edge cache
  integration, existing ellipse model's bounded high-resolution recovery and
  cheap geometric eligibility preflight.
- `src/engine/{adapters,types}.ts`, `src/lib/input.ts`, `src/main.tsx`: default
  bounded optimization, explicit rollback checkbox and real diagnostics.
- `scripts/curve-geometry-metrics.{mjs,d.mts}`, `scripts/corner-benchmark.mjs`:
  semantic editable-node counts, independent distances and unbiased sampling.
- `scripts/curve-optimization-{fixtures,research,evidence,editability}.mjs`,
  `scripts/stage14-baseline.mjs`, `tests/fixtures/curve-optimization/`: CC0 source
  geometry, archived baseline replay, actual screenshots/overlays and editor checks.
- `tests/e2e/curve-optimization.spec.ts`, `tests/e2e/app.spec.ts`,
  `tests/unit/curve-metrics.test.ts`: geometry/topology/runtime gates and selector fix.
- `.github/workflows/stage0-check.yml`, `README.md`, this report: feature-branch
  validation/artifact retention, workflow evidence, limitations and usage.

Reviewed directly against baseline main using diff inspection, degenerate/native
cases, actual downloaded SVG geometry, retained ground truth, two rasterizers
and editor import. No new tracer, upstream replacement, dependency upgrade,
forced path overlap, raster export or online solver sweep is introduced.

## GitHub and commit status

Feature commit/CI and final integration status will be recorded after push and
verification. Merge is conditional on the important regression gates succeeding;
this report does not turn the unresolved absolute fidelity failures into PASS.
