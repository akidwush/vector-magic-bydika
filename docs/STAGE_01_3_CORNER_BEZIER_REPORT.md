# Stage 1.3 — corner evidence and adaptive fitting

**Follow-up:** [Source-guided production quality correction](SOURCE_GUIDED_QUALITY_REPORT.md)
supersedes the default-policy and measurement status below. The original experimental
failures are retained here as historical evidence.

## Status: PARTIAL, not certified complete

Developed on `feat/stage-1-3-corner-bezier` from main `3f37c6e`.
This is an explicit **Corner & Bézier · uji** profile. Auto, Photo, Stage 1.2
coverage and the Stage 1.2B planar baseline are retained. Main must not be merged
on the strength of SVG validity or passing infrastructure tests alone. Full quality
acceptance is not met; experimental quality regressions remain below.

## Audit and provenance

Read AGENTS.md, Stage 1 handoff, quality plan, Stage 1 report, hotfix report,
Stage 1.2 historical/current reports and shared-edge report. Audited actual
config.rs, fitter.rs, simplify.rs, mosaic/{graph,face,fit,compose}.rs, pipeline.rs,
engine/src/lib.rs and engine/src/planar.rs. Upstream is VTracer 1.0.0-alpha.4,
`e71343fbcbf469b8a72a255030408a39939162eb`, retained MIT grant.

Confirmed weaknesses: the upstream segment fitter uses a single 60-degree default
corner threshold and FIT_ERROR=10; closed rings use simplification/smoothing before
spline fitting. Stage 1.2B recursively splits rejected chains at index midpoints
rather than semantic corners. Its small-feature .75px drift guard can reject a
smooth candidate and leave faceted pixel geometry. SimplifyCurves already operates
per shared edge and preserves its detected tangent breaks; it is not an independent
per-face simplifier. Replacing upstream graph extraction would solve none of these.

No segmentation/tracing frontend or planar graph was added. Existing ColorCluster,
label flattening, Mosaic graph, face assembly, collision repair and SVG serializer
remain in use. The existing flo_curves 0.8.0 dependency is now directly declared
by the binding: the same Schneider fitter VTracer's SimplifyCurves uses. Its existing
redistribution license is already included. Dependency versions are not upgraded.

## Detector and protected representation

For each crack-chain point, measure incoming/outgoing chord turns at 2/4/8 lattice
steps, adapting scale to available chain length. Confidence is the min/max angular
stability ratio times angular strength, bounded to [0,1]. This is a heuristic score,
not a calibrated probability. It does not classify every 90-degree raster step as a
corner. Linear-time local nonmaximum suppression avoids a quadratic candidate scan.
Open endpoints remain junction vertices; insufficient endpoint neighborhood is
uncertain rather than a new corner. Native tests distinguish a square's four
corners from diagonal staircase steps. The initial endpoint-clamped implementation
made two false diagonal corners; the test failed and the endpoint handling was fixed.

Class IDs: 0 hard, 1 soft, 2 smooth, 3 straight, 4 junction, 5 uncertain.
Bounded WASM evidence contains records `[edge,index,class,confidence,x,y,protected]`
(max 4096 records). Alpha reduces reported source confidence; these scores are
candidate evidence, not a claim of semantic understanding. Source edge-strength,
JPEG noise calibration and robust subpixel corner-line intersection refinement are
**not implemented/certified yet**. Protected positions currently use label cracks.

Hard corners split a cached edge into runs; open endpoints/junctions are retained.
Runs use upstream polygon denoising and flo_curves cubic fitting with .3px tolerance
for short point sets and .5px otherwise. Fully straight runs can serialize as lines.
Hard-corner runs are independent, so tangent continuity is not forced across a corner.
The upstream recursive fitter controls smooth internal joins; G2 is not claimed.
No later independent per-face simplification moves the two copies of a boundary.

A high-confidence axis-aligned ellipse candidate uses bounding-box center/radii,
normalized radial RMS <=.045, maximum radial residual <=.12, quadrant support and
absence of protected corners. Median normalized radial distance robustly refines
the radius scale. Four standard cubic quarter-ellipses preserve winding.
Rotated/asymmetric shapes are not certified by this model. This candidate still
must pass the unchanged bidirectional drift and collision checks; rejection can
leave the previous fitter rather than falsely claiming an analytic replacement.

If any adaptive candidate fails drift or intersection validation, the complete
RGB composition rolls back to the unchanged Stage 1.2B fitter on the same segmentation.
The adaptiveRollback diagnostic explicitly marks that decision. Candidate records
remain available, but do not certify protected retention in a rolled-back result.
An earlier raw-pixel rollback retained vertices but made faces jagged; it was rejected.
Source evidence should refine unreliable corners before locking in a future iteration.
It would be incorrect to claim that requirement is already fulfilled.

## Topology, alpha and resource behavior

Every final fitted edge is stored once in the upstream graph cache and emitted in
exact reverse for its neighbor. Existing pinned junctions, incidence checks, ring
orientation, six-decimal shared quantization, intersection checks and repair budgets
remain. Original alpha masks are applied independently after RGB composition.
Cancellation still terminates the worker; no configuration sweep runs on Convert.
No blur, cosmetic strokes, background underpainting or embedded raster is added.
SVG source-over AA hairlines remain distinct from geometric cracks.

## Fixtures and protocol

Original CC0 square, sharp triangle, star, hair silhouette and mixed straight/curve
SVGs are included with analytic corner coordinates. PNGs at 64/128/512 and quality
45 JPEG / quality 40 WebP are reproducible. Existing circle/oval, organic face,
rounded shape, thin feature, diagonal, junction, pinch, and nested-ring fixtures
supply additional ground truth. The benchmark compares the unchanged Stage 1.2B
planar route and the new profile on the same decoded source, preset and viewport.
Nineteen 128px inputs are measured. Generated 64/512 variants are not all exercised;
controlled-noise and general rotated ellipse coverage remain missing.

`corner-benchmark.mjs` samples legal reference SVG geometry and actual exported SVG
primitives. Symmetric sampled Chamfer and 95th-percentile boundary distance use
source-pixel units, not a proof of a continuous Hausdorff bound. A 2px canvas-frame
band is excluded from both sets to measure interior boundaries consistently.
Circle/ellipse metrics additionally report sampled normalized radial RMS and
bounding-box center/radius errors; they are not orthogonal ellipse residuals.
Corner matching is
greedy one-to-one within 2px of analytic truth and reports candidate precision/recall/position error;
it does not certify final locked retention after every rollback. Raw metrics include
MAE, paths/primitives, actual stage timings and graph consistency. Performance splits
retain segmentation/downstream/alpha/export; pure simplification CPU time is not
separately measured. Physical Android is NOT VERIFIED.

Screenshots show raster | planar baseline | adaptive SVG at 100/400/1000%, same
128px source and scale, in ignored benchmark-results/stage13/. Raw measurements and
screenshots are archived by CI, not committed. No Vector Magic parity is claimed.

| Fixture | Chamfer old → new px | Robust boundary p95 old → new px | Literal endpoints old → new | Candidate P/R | Mean corner error px | Rollback | Trace ms old → new |
|---|---|---|---|---|---|---|
| ../coverage/circle.png | 0.254 → 0.254 | 0.519 → 0.519 | 87 → 87 | N/A | N/A | YES | 387.9 → 39.0 |
| ../coverage/oval.png | 0.253 → 0.224 | 0.470 → 0.376 | 65 → 15 | N/A | N/A | no | 36.2 → 24.3 |
| ../corners/square-128.png | 0.212 → 0.212 | 0.500 → 0.500 | 15 → 15 | 1.000/1.000 | 0.000 | no | 12.4 → 23.7 |
| ../corners/triangle-128.png | 0.241 → 0.241 | 0.486 → 0.486 | 121 → 121 | 1.000/0.667 | 36.980 | YES | 62.8 → 71.1 |
| ../corners/star-128.png | 0.219 → 0.219 | 0.518 → 0.518 | 121 → 121 | 1.000/0.600 | 12.850 | YES | 48.6 → 32.5 |
| ../corners/hair-128.png | 0.278 → 0.278 | 0.613 → 0.613 | 201 → 201 | 0.875/0.778 | 5.668 | YES | 65.5 → 67.9 |
| ../corners/mixed-128.png | 0.244 → 0.244 | 0.539 → 0.539 | 81 → 81 | 1.000/1.000 | 0.000 | YES | 20.2 → 22.7 |
| ../corners/star.jpg | 2.067 → 2.067 | 9.487 → 9.487 | 6567 → 6567 | 0.000/0.000 | 58.427 | YES | 130.1 → 129.4 |
| ../corners/star.webp | 0.810 → 0.810 | 3.208 → 3.208 | 1012 → 1012 | 0.000/0.000 | 53.160 | YES | 52.7 → 46.8 |
| curve.png | 0.300 → 0.300 | 0.563 → 0.563 | 56 → 56 | N/A | N/A | YES | 24.0 → 19.8 |
| junction.png | 0.126 → 0.126 | 0.500 → 0.500 | 16 → 16 | N/A | N/A | no | 9.5 → 10.9 |
| organic.png | 0.287 → 0.287 | 0.619 → 0.619 | 289 → 289 | N/A | N/A | YES | 47.8 → 49.8 |
| rings.png | 0.274 → 0.274 | 0.555 → 0.555 | 155 → 155 | N/A | N/A | YES | 44.1 → 50.2 |
| rounded.png | 0.320 → 0.320 | 0.593 → 0.593 | 105 → 105 | N/A | N/A | no | 24.5 → 23.0 |
| diagonal.png | 0.308 → 0.308 | 0.570 → 0.570 | 72 → 72 | N/A | N/A | YES | 20.2 → 23.5 |
| thin.png | 0.171 → 0.170 | 0.391 → 0.388 | 23 → 23 | N/A | N/A | no | 17.7 → 14.0 |
| pinch.png | 0.126 → 0.126 | 0.500 → 0.500 | 20 → 20 | N/A | N/A | no | 7.9 → 8.5 |
| curve.jpg | 1.407 → 1.407 | 7.661 → 7.661 | 1865 → 1865 | N/A | N/A | YES | 37.5 → 44.9 |
| curve.webp | 0.717 → 0.717 | 2.347 → 2.347 | 300 → 300 | N/A | N/A | YES | 21.5 → 23.5 |

All new exported shared boundaries match exactly and all sampled gap/overlap checks pass. These are topology gates, not quality certification. Corner scores refer to recorded candidates, including proposals rejected by rollback; multi-region inputs may have only an analyzed prefix before rollback, so those figures are not whole-image detector precision/recall; missed corners are penalized by nearest-candidate position error.

../coverage/circle.png: ellipse accuracy old → new (center error px, normalized radial RMS px, x/y radius errors px): [{"centerError":0.259782343634952,"radialRms":0.24949174348259215,"radiusXError":0.017001557617184915,"radiusYError":0.038194866985556075},{"centerError":0.259782343634952,"radialRms":0.24949174348259215,"radiusXError":0.017001557617184915,"radiusYError":0.038194866985556075}].

../coverage/oval.png: ellipse accuracy old → new (center error px, normalized radial RMS px, x/y radius errors px): [{"centerError":0.1764009392112294,"radialRms":0.2621591311221648,"radiusXError":0.12967143737601106,"radiusYError":0.06106850000000108},{"centerError":0.22360679774998216,"radialRms":0.14292397324601291,"radiusXError":0.007901000000003933,"radiusYError":0.022365000000000634}].



## Verification and remaining acceptance gaps

12 project Rust tests and 32 TypeScript tests pass; the existing upstream 31-test
suite is retained by CI. A stable local full-browser run passed 15 tests, including adaptive alpha at
128/512/1024. The final median-radius adjustment passed the two dedicated adaptive
browser tests again. Remote CI is reported separately.
WASM build, lint, typecheck and static build were run successfully.

Full Stage 1.3 acceptance remains **FAIL/incomplete**: source-aware subpixel corner
refinement is missing, ellipse candidate rejection/faceted fallback persists,
noise/rotated/asymmetric shape classification is not fully calibrated, some inputs
increase node count or boundary error, and protected-corner benchmark coverage is
not complete. These findings block global promotion and a quality-complete merge.
No acceptance threshold was lowered to conceal a regression.

Files: engine/src/corners.rs, engine/src/planar.rs, engine/src/lib.rs,
engine Cargo manifest/lock, TypeScript profile/adapters/input/diagnostics/types/UI,
corner fixtures/generator, corner benchmark, browser comparison tests, both CI
pipelines, this report. Prior reports and upstream vendor algorithms are preserved.

Reproduce (pinned toolchain per README):

```bash
node scripts/corner-fixtures.mjs
cargo test --manifest-path engine/Cargo.toml --locked
npm run build:wasm
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:e2e
node scripts/corner-benchmark.mjs
```

Local browser is Chromium 154; CI uses Playwright Chromium. Set
NEXORA_CHROMIUM_PATH=/usr/bin/chromium and NEXORA_TEST_PORT=4175 here.
GitHub: branch pushed at `caf8f88`. [CI run 40141616890](https://github.com/akidwush/vector-magic-bydika/actions/runs/40141616890)
completed SUCCESS, observed on the public GitHub Actions page. This verifies build,
43 native Rust tests, 32 TypeScript tests and 15 browser tests plus benchmark export;
it does not certify Stage 1.3 visual/geometric acceptance. No merge to main occurred.
The main branch remains at `3f37c6e` because quality acceptance is incomplete.

The ellipse model uses a robust median radius scale; the measured oval improves
while the circle candidate is rejected and rolls back. Candidate recall on triangle
and star remains below acceptance. Final rollback avoids the earlier node explosion
and jagged-face regression; it does not turn rejection into fitting success.

The full local suite passed after freezing build artifacts. One earlier local
cancellation run overlapped a dist rebuild and was invalidated; the subsequent
stable full run and remote CI both pass the unchanged cancellation assertions.
