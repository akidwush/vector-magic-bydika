# Source-guided contour quality correction

## Scope and baseline

This follow-up develops `feat/source-guided-quality` from `9a8e152`, with
GitHub main `3f37c6e` as the production baseline. It corrects the default Auto
path, rather than presenting a better experimental screenshot as a production
fix. `Pembanding Auto lama` reproduces the previous Auto policy, including its
Stage 1.2 coverage refinement; `previous` is an older, different comparator.

The measured corpus demonstrates improvements in clean flat-color artwork.
This is not a claim of Vector Magic equivalence or universal Stage 1.3 completion.
The owner's actual failing upload/export is not available in this workspace.
JPEG/WebP reconstruction and arbitrary translucent artwork remain limited.

## Confirmed causes

1. The broad `blended-flat` heuristic also classifies ordinary antialiased PNG
   artwork as blended. Sending all of it to Watershed leaves transition-colored
   islands in some fixtures. Independent fitting then follows those islands:
   wavy cheeks, a broken bottom edge, excess paths and distorted small eyes.
2. The upstream mask fitter still approximates small circles with irregular
   splines. Increasing smoothing globally does not reliably recover their geometry.
3. PixelFitter coalesces axis-aligned runs. The original drift-check index stored
   only the first cell of each raw segment, wrongly rejecting good curves near
   the middle of longer segments. The index now covers the full segment.
4. A low pixel-coverage loss does not protect an acute corner. A trial improved
   star/triangle raster MAE while losing true tangent breaks. Final-output corner
   recall caught this; the trial was not merged.
5. Converting a closed polygon subpath back to fitting geometry must restore its
   closing edge. An intermediate implementation omitted it; native/browser
   checks exposed the rejection of otherwise valid polygon models. It is fixed.

## Retained open-source foundation

VTracer **1.0.0-alpha.4**, upstream
`e71343fbcbf469b8a72a255030408a39939162eb`, remains the tracing engine.
Its MIT notices, ColorCluster/Watershed segmentation, connected components,
PixelFitter, PolygonFitter, SplineFitter, boundary graph and face assembler remain
in use. Cubic fitting uses the existing **flo_curves 0.8.0** Schneider implementation,
also used by upstream SimplifyCurves. Visioncortex remains **0.9.3**.
No vendor code is changed in this follow-up; no replacement raster tracer exists.

References: [VTracer](https://github.com/visioncortex/vtracer),
[flo_curves](https://github.com/Logicalshift/flo_curves),
[visioncortex](https://github.com/visioncortex/visioncortex).

## Algorithm and assumptions

### Local evidence before segmentation

Auto selects this route for PNGs with at least 96% coverage in the eight dominant
coarse RGB bins and at most eight bins needed for 95% visible coverage. This is
only a broad routing gate. Every changed pixel additionally requires local
stable colors on opposite sides, sufficient contrast, a small mixture residual,
and consistent direction on three parallel profiles. Four candidate normal
orientations are examined. A color repeated in at least two immediate neighbors
is kept; stable third-color plateaus, unsupported neighborhoods and real alpha
are not relabeled. Only a segmentation copy is changed; the original RGBA remains
the fitting reference. There is no image blur.

The model is `C ≈ t A + (1-t) B`, initially in decoded encoded-RGB space.
The projection estimates `t`; the segmentation copy takes the supported interior
color on the appropriate side of 0.5. A/B must agree at distances two and three
pixels, contrast squared must exceed 2500, RGB residual must be at most 2.5,
and the directional coverage difference must exceed 0.15 on all three profiles.
This is a conservative model assumption, not proof that an ambiguous stripe is AA.
Canvas borders containing multiple colors also retain the previous segmentation
to avoid extrapolating clipped objects. Broad blurred/complex inputs retain the previous policy. If the blended route
finds no supported cleanup, it retains Watershed/mosaic instead of forcing a
segmentation change. JPEG/WebP, Photo and complex gradients retain their defaults.
Partial-alpha inputs bypass this cleanup entirely and retain vector opacity masks.

Cleanup currently applies up to a 256 px longest side. Larger inputs keep their
original segmentation and still permit source-verified model-only refinement.
This conservative scope follows the resolution regression below, rather than
claiming an unverified high-resolution cleanup improvement.

### Source-verified geometry

Existing VTracer contours supply all geometry candidates. Opaque two-color bands
provide coverage samples. Third-color samples inconsistent with the model are
excluded; excessive contamination, weak contrast, missing colors or any partial
alpha in the sampled band reject the proposal. Scalar projected coverage does
not uniquely determine the hidden vector boundary.

Closed rings can use the improved multi-scale corner fitter or a bounded ellipse
model. Ellipse center and radii are optimized within 0.8 px of the extracted bounds;
four cubic quarters represent the result. Each candidate is compared with the
actual previous coverage-refined contour using the same deterministic 4×4 area
integration. Ordinary replacement needs over 5% relative loss improvement, an
absolute margin of 0.00005, MSE below 0.01, finite closed geometry, correct winding,
bounded bidirectional drift and no forbidden intersection. Quantized geometry is
scored before acceptance. Unsuccessful proposals keep the cached baseline.
Canvas-clipped components keep the prior fitting/refinement: the missing exterior
provides insufficient evidence for the new closed-ring model.

### Corners, straight sides and Bézier runs

Corner evidence uses support-line tangents at several arc-length scales, angular
stability, intersection locality and nonmaximum suppression. Unit samples are
restored when upstream PixelFitter coalesces runs. The hard/soft/smooth/straight/
junction/uncertain classes and heuristic confidence remain available as proposal
diagnostics. They do not certify that every proposed corner was exported.

Closed all-straight shapes additionally reuse upstream PolygonFitter. Redundant
near-collinear samples and short raster caps are reduced in geometry space.
Temporary support-line intersections are hypotheses, not protected positions.
A bounded source-coverage parameter fit refines the retained vertices before
locking them. At most twelve vertices and 4096 local samples are allowed for
this model; all source fits share an 8192-sample trace budget. Final drift,
closure, winding and self-intersection checks still apply. The temporary miter
can be farther away; it is never exported without the final source/geometry checks.
A Bézier replacement must retain the protected polygon's actual tangent breaks.
The verified triangle has three straight sides; the verified star has ten corners.

Smooth runs reuse flo_curves with endpoint tangents and local error tolerances.
Small polyline fairing acts on contour geometry and is accepted only with source
validation. It is not raster blur. Accepted source models are protected from a
second independent coverage displacement after composition.

### Shared-edge compatibility and compositing

The explicit locked graph mode still builds and fits each edge once and uses its
exact reversal for the adjacent face. Source-guided proposals are accepted per
edge; a rejected eye/edge no longer rolls back every valid curve in the document.
Global collision checking reverts affected proposals to the cached safe geometry.
For eligible opaque PNGs, the experimental intelligent graph also benefits from
the selective segmentation copy. Absolute six-decimal serialization is retained.

The existing Watershed/mosaic fallback can refine isolated closed shared rings by
atomically replacing both orientations. Other chains stay unchanged. The default
clean-art route retains VTracer's stacked painter representation; it is **not** a
promise of a globally shared planar subdivision. Choose the locked graph profile
when that invariant is required. It remains independently tested for exact edge
coincidence and geometric gap/overlap, separately from SVG antialias hairlines.
There are no covering strokes, hidden raster images, SVG blur or preview-only fixes.

## Measurement method and final results

All fixtures have retained legal vector ground truth/provenance (project CC0;
OpenMoji is separately attributed CC BY-SA 4.0). The same uploaded raster, preset,
viewport and scale are used for old/new exports. SVG downloads are rendered in
Chromium and independently in libvips. Original/old/new screenshots at 100%, 400%
and 1000% are generated offline, never during a user conversion.

Geometric distance uses sampled points against piecewise geometry, in both
directions. It does not compare only two point clouds: a sparse exact straight
edge must not score worse merely because it uses fewer anchors. Cubic and
reference curves are sampled for bounded numerical approximation. A 2 px canvas
frame ROI is excluded consistently. Corner metrics inspect tangent breaks in the
actual exported SVG with one-to-one matching within 2 px, not just detector logs.
No SVG-validity or path-count-only acceptance is used.

Local Chromium 154, production WASM build, Illustration preset, 128×128.
MAE uses premultiplied RGBA (0–255); distances are sampled geometric pixels.

| Fixture | MAE old → new | Mean boundary old → new (px) | p95 old → new (px) | SVG endpoints old → new | Trace old → new (ms) |
| --- | --- | --- | --- | --- | --- |
| circle.png | 0.988 → 0.596 | 0.2126 → 0.0217 | 0.6058 → 0.0490 | 13 → 10 | 58.0 → 61.5 |
| oval.png | 1.070 → 0.640 | 0.2573 → 0.0165 | 0.6285 → 0.0466 | 14 → 10 | 10.4 → 23.1 |
| triangle-128.png | 0.631 → 0.422 | 0.0898 → 0.0002 | 0.3678 → 0.0000 | 20 → 8 | 9.0 → 51.7 |
| star-128.png | 1.407 → 0.590 | 0.3244 → 0.0626 | 0.7774 → 0.4006 | 53 → 15 | 11.5 → 129.8 |
| organic.png | 1.634 → 0.957 | 0.2740 → 0.1415 | 1.0559 → 0.3792 | 143 → 40 | 16.1 → 56.5 |
| rings.png | 1.730 → 0.629 | 0.1494 → 0.0043 | 0.4840 → 0.0107 | 141 → 20 | 23.3 → 54.4 |
| rounded.png | 1.292 → 0.761 | 0.3967 → 0.1180 | 1.7779 → 0.3904 | 93 → 48 | 30.1 → 100.4 |
| thin.png | 1.169 → 0.710 | 0.3013 → 0.0000 | 1.1181 → 0.0000 | 105 → 13 | 14.9 → 31.2 |

SVG endpoint counts include background paths and serialized subpath starts; they
are not counts of unique object vertices. Timing pairs are single observations
with order/JIT effects, not speedup statistics.

| Actual exported corners | Precision old → new | Recall old → new | Mean matched position error old → new (px) |
| --- | --- | --- | --- |
| square | 1.000 → 1.000 | 1.000 → 1.000 | 0.000 → 0.000 |
| triangle | 0.750 → 1.000 | 1.000 → 1.000 | 0.478 → 0.000 |
| star | 0.833 → 1.000 | 1.000 → 1.000 | 0.967 → 0.149 |
| mixed | 1.000 → 1.000 | 1.000 → 1.000 | 0.000 → 0.000 |

Circle radial RMS falls from 0.278 to 0.0265 px; oval from 0.347 to 0.0196 px.
Center errors fall from 0.219/0.249 px to zero at the measured parameter precision.
That precision is not proof of exact recovery for unknown artwork.

Organic feature IoU (left eye, right eye, nose): [0.9358974358974359, 0.9358974358974359, 0.8648648648648649] → [1, 1, 0.9705882352941176].

Held-out opaque cat eyes improve to IoU 1.000/1.000. The project 128px partial-alpha
cat retains silhouette IoU 0.983604 and improves its eyes to 1.000/1.000. The fixed
0.980 target was not lowered. The blurred cat, lossy cat and licensed OpenMoji
default outputs are unchanged. The intentional pink region remains present.

Analytic edge-srgb.png: x=[63.17] versus 63.25 px ground truth, matching the previous Auto error.
Analytic edge-linear.png: x=[63.17] versus 63.25 px ground truth, matching the previous Auto error.

Across the 19 comparison cases, both rasterizers pass the color/coverage regression
gates; final-output corner gates pass for square/triangle/star/mixed shapes. The
mean and p95 geometric boundary errors also pass a 0.02 px regression allowance.
The clipped curve/diagonal/junction cases retain their previous geometry.
All 19 intelligent-graph comparisons have exact paired interior geometry, zero
incidence/crossing errors and zero sampled geometric gaps/overlap. Renderer
antialias seam counts remain nonzero and are retained in the raw measurements;
they are not described as a universal gapless rendering fix.

Local checks: 18 integration/native Rust tests, 31 upstream library tests,
33 TypeScript unit tests, lint/typecheck, WASM and production build passed;
16 browser tests passed before the additional resolution regression; the expanded
suite now includes a seventeenth browser test. The geometry and dual-renderer benchmark scripts passed.



### Resolution regression added after initial branch CI

A new 512px test caught corner loss after the polygon parameter-fit budget was
exhausted. Corner protection now remains active independently of that budget.
Selective cleanup is conservatively limited to a 256 px longest side; larger
inputs preserve the previous segmentation. The 512px star therefore retains its
old geometry rather than being advertised as improved. No corner threshold or
expected corner count was lowered.

| Shape | Resolution | True corner hits old → new | Circle radial RMS old → new (px) |
| --- | --- | --- | --- |
| triangle | 64 | 3 → 3 | — |
| star | 64 | 10 → 10 | — |
| circle | 64 | 0 → 0 | 0.2863 → 0.0180 |
| triangle | 256 | 3 → 3 | — |
| star | 256 | 10 → 10 | — |
| circle | 256 | 0 → 0 | 0.2156 → 0.0114 |
| triangle | 512 | 3 → 3 | — |
| star | 512 | 10 → 10 | — |
| circle | 512 | 0 → 0 | 0.2054 → 0.0249 |

## Runtime and browser lifecycle

Each Convert still runs one segmentation/tracing configuration. Numeric fitting
optimizes bounded model parameters, not a sweep of tracing presets. Research
comparisons are offline only. The 2 MP source limit, 8192 source-sample budget,
shared-graph crack/intersection budgets, worker cancellation by termination,
warm reuse and idle release remain. No user image leaves the browser.

Timings now expose preparation and fitting separately from segmentation,
refinement, alpha export and SVG serialization. Existing combined postprocess
is an aggregate, not a second independent fitting measurement. Upstream
simplification is included in fitting; it is not separately instrumented.
Model fitting costs more than the old baseline. Measurements are desktop headless
Chromium observations, not physical Android results or statistically controlled
speed claims. Cancellation, worker replacement and mobile layout remain tested.

## Rejected experiments and remaining limits

- Reducing node count or improving pixel MAE alone allowed rounded star/triangle
  tips. Final-output corner gates now reject this regression.
- Changing every blended input to ColorCluster reduced color error but regressed
  the blurred cat silhouette. That broad switch is not enabled; the measured
  blurred input retains its exact previous Auto output.
- Additive SVG compositing reduced Chrome hairlines in an offline experiment,
  but libvips did not honor it. No blend-mode CSS or sanitizer permission was added.
- Polygon refinement on a canvas-clipped half-plane could suppress the prior
  subpixel displacement. Such components now retain the baseline. The analytic
  edge fixtures have a measured remaining positional error; they are not claimed
  to reconstruct an exact hidden line from ambiguous color-space evidence.
- Source reconstruction still assumes mostly solid two-color edge neighborhoods.
  JPEG/WebP compression, small gradients, intentional narrow stripes, unobserved
  color management and arbitrary translucent overlaps are not generally solved.
- Existing lossy fixtures can still have many small paths; unchanged is not PASS
  against a professional-quality target. The OpenMoji alpha silhouette also remains
  below 0.980; only the required project partial-alpha fixture meets that target.
- Open multi-region junctions remain conservative lattice-constrained geometry.
  Circle fitting is axis-aligned and confidence-gated; rotated/asymmetric eyes
  are not forced into a perfect ellipse.
- No physical Android device, external vector-editor interoperability study,
  representative owner-upload corpus or Vector Magic comparison is available.

## Files and reproduction

`engine/src/source_fit.rs` adds source scoring, selective cleanup, bounded models
and atomic shared-ring replacement. `corners.rs`, `planar.rs`, `coverage.rs` and
`lib.rs` integrate corner protection, per-edge fallback, drift-index correction,
protected refinements and stage timings. TypeScript adapters/diagnostics/types,
input profile typing and the contour selector expose the new Auto behavior and
an exact old-Auto comparator. `corners.spec.ts`, `source-quality.spec.ts`, diagnostic
unit tests, `corner-benchmark.mjs`, `source-quality-evidence.mjs` and the GitHub
workflow verify final exported geometry and two independent renders. README and
this report document scope and limitations.

```sh
cargo test --manifest-path engine/Cargo.toml --locked
cargo test --manifest-path engine/Cargo.toml --locked -p vtracer --lib
npm run build:wasm
npm run lint && npm run typecheck && npm run test
npm run build
npm run test:e2e
node scripts/corner-benchmark.mjs
node scripts/source-quality-evidence.mjs
```

For this workspace use `NEXORA_CHROMIUM_PATH=/usr/bin/chromium` and an unused
`NEXORA_TEST_PORT` for browser tests. CI installs Playwright Chromium normally.

Screenshots and raw measurements are generated artifacts, deliberately not git
content (`AGENTS.md`). CI artifact `stage-01-evidence` contains
`benchmark-results/source-quality/organic.png-400.png`, corresponding 100/1000%
views, circle/star/triangle comparisons, `stage13/geometry.json`, `source-quality/
renderers.json`, held-out measurements and actual SVG exports in `test-results/`.

## Review, CI and GitHub

Implementation review includes unchanged third-party sources/licenses, a clean
source-only diff, no raster/stroke/CSS concealment, bounded memory/work,
protected-corner checks, shared-edge/cancellation regression suites and measured
old/new Auto comparisons. Remote CI and merge status are recorded after the
corresponding runs finish; local success is not remote CI evidence.

Initial implementation `0e165b5`: [GitHub CI passed](https://github.com/akidwush/vector-magic-bydika/actions/runs/40162596616).
The subsequent resolution fallback fix is awaiting its own branch CI; main has
not yet been merged at this report revision.
