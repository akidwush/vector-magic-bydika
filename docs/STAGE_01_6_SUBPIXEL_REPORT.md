# Stage 1.6 — analytical coverage and calibrated colour evidence

Baseline: `6084faffbd18313c80b7d4bc8bec349dd88b63c8` (Stage 1.5 main).
Branch: `feat/stage-1-6-analytical-coverage`.
Status: **PARTIAL; do not merge/promote as completed Stage 1.6.**

## Audit and corrections

VTracer 1.0.0-alpha.4, visioncortex and flo_curves are retained. No tracing,
segmentation, graph or optimizer dependency is replaced. The Stage 1.5 continuous
polygon evaluator already implements Green's theorem; implementing a second
rasterizer would duplicate it. Its flattening approximation is not an exact
analytic integral of a cubic. Precision of an evaluator is not accuracy of the
reconstructed shape.

Canvas `getImageData` supplies straight RGBA. Unpremultiplying these samples again
would amplify noise and alter source colours. Alpha equals geometric coverage
multiplied by intrinsic opacity in the simple foreground model; those factors
cannot be separated uniquely from one observation. The existing vector opacity
masks remain in use. Semi-transparent interiors are not treated as missing area.

`transitions.ts` has local direction/interior consistency checks, but no face
ownership graph. Colour-line membership alone cannot authorize deleting a pink
region. No unconditional transition stripping or global colour-space selection
has been added. JPEG/WebP and ambiguous boundaries keep existing handling.

## Implemented changes

- `alpha.rs` centralizes the piecewise IEC sRGB transfer functions and tests both
  toe branches. `coverage.rs` reuses the same decode function.
- `unmix.rs` implements bounded two-colour projection and chain/component-level
  model selection. Both model predictions are re-encoded and scored in the same
  encoded-RGB units. At least eight interior mixture samples, a quantization
  floor and a twofold evidence margin are required. Grayscale/weak/ambiguous
  cases return no selection. This is conditional evidence, not a gamma guarantee.
- `source_fit.rs` uses confirmed linear-light selection only for the existing
  experimental source-support path. Uncertain selection keeps Stage 1.5 evidence.
  Existing ownership, colour residual, opacity, source and topology guards apply.
- `transitions.ts` exposes the same calibrated diagnostic, with quantized mixture
  and intentional-third-colour tests. It does not mutate pixels or labels.
- `inverse.rs` keeps the existing continuous polygon evaluator. Integration is
  split at clamp breakpoints and evaluated by trapezoids, avoiding cancellation
  in subtraction of nearby quadratic antiderivatives. Final source validation
  tightens flattening from 0.002px to 0.001px; coarse search budgets remain.
- The analytical coverage-to-normal-offset inversion is tested against independent
  polygon clipping at 360 orientations and 11 fractions, including 1/64 and 63/64.
  For foreground `n·(x-centre)<=d`, the target is `centre+d*n_unit`. The opposite
  sign in the initial specification would move the boundary in the wrong direction.
  This helper is deliberately not used to move anchors before a full geometric
  validation corpus exists.
- `build-wasm.sh` is executable, so the requested direct command works.
- `coverage-research.mjs` now sends corner/length/smoothing configurations to the
  actual `experiment` binding. Previously the requested default invocation failed
  with `Invalid quality profile`. Production profiles still use `trace_quality`.
- `subpixel-proof.mjs` validates actual gamma fixtures and blocks any primary
  absolute mean/p95/max regression relative to Stage 1.5, independently of the looser
  historical Stage 1.4 improvement gate. It records research target failures.

No reducer tolerance, corner threshold or topology safety guard was relaxed.
No global Auto promotion, stroke concealment, raster embedding or alpha flattening
was introduced. Shared boundaries still use the existing cache and exact reversal.

## Measured proof and limits

The nearly-flat integral regression has endpoints 0.7123456 and 0.7123456+2e-12.
Old subtraction error: 0.0000107493293 area; new trapezoid error: 0 at double
precision against the analytic trapezoid. This is a numerical unit example,
not a claim that this magnitude occurred in an actual artwork export.

Independent polygon clipping over 3960 orientation/fraction cases gives maximum
area residual 2.220446049250313e-16. This validates the mathematical sign and
inverse, not subpixel recovery from noisy 8-bit raster artwork.

Actual PNG diagnostics select `linear` for edge-linear and `srgb` for edge-srgb
(32 repeated transition samples each). The fixture proof uses their known two
uniform interiors; that palette extraction is not production segmentation.

| 1024px fixture | Stage 1.5 mean → candidate px | Stage 1.5 sampled max → candidate px | 1/16px max | 1/64px max |
|---|---:|---:|---|---|
| Cubic | 0.09176246 → 0.09176246 | 1.56151312 → 1.56151312 | FAIL | FAIL |
| Wave | 0.07944780 → 0.07944780 | 1.00000000 → 1.00000000 | FAIL | FAIL |

The primary reconstruction has **not improved further** in these experiments.
The new numerical/gamma foundations pass their tests, but do not establish the
requested end-to-end geometric precision. Node counts and protected corners on
these fixtures remain the same. No Vector Magic equivalence is claimed.

Local desktop trace samples: cubic 709.2→667.5ms, wave 673.3→563.0ms; solver subsets
274.1→264.0ms and 188.1→146.2ms. These single observations are not a speedup claim;
noise, CPU scheduling and warm state matter. Physical Android and peak RSS are
unmeasured. Existing WASM linear-memory diagnostics and work caps are retained.

Alpha research (all modes, real SVG rasterization):

| Size | Spline IoU | Polygon IoU | Pixel IoU |
|---|---:|---:|---:|
| 128 | 0.978553 **FAIL 0.980** | 0.983604 | 0.999846 |
| 512 | 0.994063 | 0.995302 | 0.999990 |
| 1024 | 0.997334 | 0.997739 | 0.999969 |

Pixel-mask IoU alone is not proof of smooth geometry. No alpha mode is promoted
from this comparison; production retains its existing polygon opacity masks.
The failed spline experiment remains reported rather than lowering the target.

## Verification and artifacts

39 native Rust tests, 31 upstream tests, 37 TypeScript tests, lint/typecheck,
production WASM/Vite builds and all 21 Playwright tests pass locally. These
include every requested coverage, source-quality, source-refinement and stage12
browser test. Source-refinement proof covers 35 exported comparisons in Chromium
and libvips. Inkscape CLI imports/roundtrips four actual SVG exports successfully.

Executed `alpha-research.mjs`, `coverage-research.mjs` (after fixing its stale
binding), `source-coverage-benchmark.mjs`, `source-refinement-evidence.mjs`,
`source-refinement-editability.mjs`, `source-refinement-quality-gate.mjs` and
`subpixel-proof.mjs`. Research scripts require the separately compiled
`--features experiments` WASM in `benchmark-results/quality/wasm`; production
WASM does not expose those experiment bindings.

Raw metrics/exports and equal-scale 100/400/1000% comparisons are ignored artifacts:
`benchmark-results/stage15/`, `benchmark-results/stage16/proof.json`, and
`benchmark-results/coverage/alpha.json`. The Stage 1.5 baseline is archived in
`benchmark-results/stage16/baseline*.json`. CI uploads the evidence artifact.
Source-refinement comparisons still include the Stage 1.4 reference; the extra
Stage 1.6 proof checks the stricter Stage 1.5 numerical baseline explicitly.

## Rejected normal-handle experiment

The `experiments` build includes a bounded coordinate-descent prototype: four
selected smooth joins, four diminishing angles (0.004/0.002/0.001/0.0005 radians),
both signs, fixed anchors and coupled handle-pair rotations retaining G1 direction.
It rejects corner joins, excessive displacement and invalid raw geometry before
scoring original source coverage. The normal Stage 1.5 final rollback gates apply.
It is compiled out of production WASM, including the user-facing source checkbox.

Actual 35-case browser exports pass existing source gates, but gains are too small
for the cost. Cubic mean 0.09176246→0.09131255; wave mean 0.07944780→0.07935990.
Neither maximum improves. Wave p95 worsens 0.29847397→0.29923853. Source loss drops
0.00504527→0.00499793 (cubic) and 0.00440529→0.00439611 (wave). Local trace time rises
667.5→1154ms and 563→1098.9ms. This is **rejected for activation**, not represented
as a successful precision milestone. Evidence is archived separately under
`benchmark-results/stage16/normal-candidate/`. The main table reports the retained
production candidate, without these rotations.

## Unfinished work and promotion decision

Confidence-weighted source-target fitting, production normal-direction handle optimization,
verified geometric-alpha separation and ownership-aware transition relabeling
are **not completed** in this patch. The signed-offset helper is validated but
not connected to anchor movement. The planar open-edge sampling path retains
its existing model. There is no new guarantee for compressed or clipped contours.

Promote neither globally nor as a completed milestone until these changes show
real exported boundary improvements over Stage 1.5 on held-out curves, with
corner/topology/alpha and runtime gates. Current delivery stays on its feature
branch. Reference methods (Green's theorem, inverse rendering, two-colour matting)
are mathematical foundations; no claim about proprietary Vector Magic internals
or direct DiffVG implementation is made.

GitHub CI runs on this feature branch and includes the strict Stage 1.5 retention
proof. [Per-commit workflow status and evidence](https://github.com/akidwush/vector-magic-bydika/actions?query=branch%3Afeat%2Fstage-1-6-analytical-coverage).
A green build is not promotion of the failed end-to-end precision targets.
