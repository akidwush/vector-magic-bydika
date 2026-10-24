# Stage 1.2 — Issue #2 implementation and evidence

## Status: PARTIAL; measured improvements shipped, full clean-vector quality not certified

Issue: https://github.com/akidwush/vector-magic-bydika/issues/2
Starting main: `5a22e2954f5ff31a6f605a53f705c66016f43a45`, clean and matched remote.
The issue was read from GitHub's public HTML after the existing GitHub API route
returned Forbidden. Existing earlier owner instruction to work directly on main
was retained; no force push, unrelated edits, issue comment or premature issue closure.
Remote CI status cannot be verified through the blocked API. Local results are separate.

The exact owner's original raster and exported SVG remain **NOT VERIFIED**; neither
file is available. Screenshots do not establish source alpha, dimensions or active engine.
No user-specific fix, physical Android speed result, or Vector Magic parity is claimed.

## What changed

- The existing VTracer pipeline is reused unchanged. The project binding selects an
  upstream `SplineFitter` with 90° corner threshold for connected components whose
  binary masks have >=.94 IoU with an inscribed ellipse, dimensions >=4, aspect ratio
  .5–2. Other components retain their original fitter (Polygon for Logo, Spline for
  Illustration). Component splitting delegates to upstream binary clustering; no new
  contour/curve algorithm, analytic replacement shapes, or coordinate-specific fixture
  logic is used. This avoids smoothing triangle noses and ear outlines as if circles.
- Non-destructive diagnostics measure alpha zero/partial coverage, RGB-bin coverage,
  approximate color-bin count covering 95%, horizontal low-contrast edge fraction and
  tiny-difference noise proxy, source MIME, dimensions/MP, effective profile and engine.
  These are heuristic statistics, not semantic or AI classification. Encoded-flat is
  distinguished using actual JPEG/WebP format; it does not prove noise is present.
- Auto uses the ellipse-aware stacked fitter for statistically flat inputs. Opaque
  blended-flat inputs (eight bins >=85% visible mass, low-contrast neighbor fraction
  >.65, PNG/nonlossy encoding, no partial or zero alpha) use upstream Watershed detail
  96, Cutout, Spline, corner 90°, length 2 and simplify .25px. This restricted route is
  **not** enabled on partial alpha, JPEG/WebP, complex images or Photo.
- Complex inputs and Photo retain the baseline pipeline. Existing thin-line fixture
  gets no palette denoise and retains baseline geometry. Presets stay visible; the
  contour selector provides Auto, Baseline Stage 1.1 and explicit shared-boundary
  experimentation. Photo keeps the detail pipeline and disables that selector.
- Partial alpha is explicitly reported **quality unsupported**, including a prominent
  output warning. No opaque background flattening is applied to hide the limitation.
  Native opaque RGB paint cannot faithfully reproduce arbitrary alpha. The optional
  shared-boundary route improves the licensed sample, but does not certify alpha.
- Completed jobs reuse one initialized worker and engine promise. Cancel/active job
  replacement terminate the worker; stale replies AND stale worker errors are ignored.
  Reset, unmount and 30s idle release it. Changing files retains an idle worker safely;
  input buffers are transferred, not cached for later conversions. There is one trace
  per click, never a runtime candidate sweep.
- Instrumentation separates decode, initialization, diagnostics, upstream segmentation
  completion and downstream fitting/color/composition/optimization. The segmentation
  timestamp uses upstream progress callbacks; postprocess includes serialization and
  residual bookkeeping. WASM linear memory bytes are recorded separately from timings;
  they are not process RSS or total browser/Android peak memory.

## Provenance and fixtures

VTracer core remains **1.0.0-alpha.4**, commit
`e71343fbcbf469b8a72a255030408a39939162eb`, supplied MIT grant. Vendor source unchanged.
ImageTracerJS stays 1.2.6/Unlicense. The development-only `svg-path-parser@1.1.0` (MIT)
is lockfile-pinned for actual SVG anchor/control-point counting; not bundled at runtime.
Original NEXORA licensing remains undecided. No new runtime service or paid dependency.

New fixture family has legal vector ground truth: project-owned CC0 cat at 128/512,
synthetic blended edges (.7px test-input blur only), JPEG/WebP quality 60 encodes,
and the existing binary/partial-alpha, thin-line, corner and gradient fixtures.
Production does **not** blur/upscale/flatten these inputs. Real artwork is OpenMoji
cat 1F431 by OpenMoji contributors, **CC BY-SA 4.0**, pinned to
`aeb8bb3a59e2de39c754ac79180c8131c906acea`. Source SVG, resized PNGs, attribution and
full license are retained under tests/fixtures/stage12/. Those derivatives retain
CC BY-SA 4.0; this does not relicense the application. No competitor artwork used.

## Experiments and rejected candidates

Initial offline browser matrix: 13 global fitter/simplify/Watershed configurations on
five sources = 65 traces. Additional paired matrices tested component-aware fitting,
shared boundaries and localized palette denoise, then final policy on 20 sources
(40 unchanged-baseline/final comparisons). Research executes WASM in a browser page;
production tests separately prove worker execution. Research exports are feature-gated
and generated outside the production WASM directory.

- Global 90/120/180° smoothing improves circularity but can harm body/ear boundaries.
- Simplify .25/.5/.75 can improve silhouettes yet square small eyes: clean-eye IoU
  falls .889 → .850/.800 for the global candidates. Not enabled globally.
- Watershed on partial alpha/transparent art fails badly in some candidates. Only
  the tested opaque blended route is auto-enabled. Shared boundaries remain an
  explicit opt-in for other inputs rather than a mandatory global preset switch.
- Palette-guided compression cleanup was implemented and tested OFFLINE: only opaque
  3×3 neighborhoods agreeing on the nearest source-palette color, delta <=12, no alpha
  or boundary rewrite. It was **rejected**: 512px lossy JPEG boundary F1 .980 → .940,
  and ~30ms preprocessing in that run. It remains a research utility, never imported
  into the application. There is no runtime global blur or stroke cover-up.
- Cutout alone can increase opaque RGBA MAE from antialiased shared edges, despite
  better boundary alignment. All tradeoffs below remain visible; RGB MAE is not used
  alone as a quality certification.

## Actual production geometry checks (same source, matching resolution)

Ground truth for cat shape metrics is the known clean vector rasterization, not a
competitor output. Edge F1 uses 1px Euclidean tolerance; symmetric contour distance
is in pixels, capped at 8px in the search (large errors saturate). Eye radial CV is
boundary-radius deviation around its centroid (lower roundness error is better).
It is pixel-scale dependent, not an analytic circularity claim. Muzzle overlap uses
its known color/ROI. Thin details, interior holes and connected ears are independently
gated by the earlier quality tests. Background-only/gradient masks can have no contour;
those edge metrics are N/A, not evidence of perfect fidelity.

| Source | Contour mode | Edge F1 before → after | Eye IoU before → after | Eye radial CV before → after | Muzzle IoU before → after |
|---|---|---|---|---|---|
| quality/cat-128-opaque.png | adaptive | 0.9984 → 0.9984 | 0.8889 → 0.9157 | 0.0802 → 0.0550 | 0.9857 → 0.9857 |
| stage12/cat-128-blended.png | blend | 0.8930 → 0.9984 | 0.8478 → 0.9198 | 0.0799 → 0.0676 | 0.9759 → 0.9870 |
| stage12/cat-128-lossy.jpg | adaptive | 0.9479 → 0.9479 | 0.8569 → 0.9067 | 0.0971 → 0.0781 | 0.9636 → 0.9640 |
| stage12/cat-128-lossy.webp | adaptive | 0.9968 → 0.9968 | 0.8964 → 0.9084 | 0.0696 → 0.0628 | 0.9800 → 0.9800 |
| stage12/openmoji-cat-128.png | adaptive | 0.7749 → 0.7749 | N/A → N/A | N/A → N/A | N/A → N/A |

OpenMoji auto deliberately retains its alpha warning and mostly baseline geometry.
Explicit shared-boundary mode improves browser-tested boundary F1 to **0.9759**;
partial-alpha fidelity remains unsupported. It is not reported as an auto-policy gain.
Logo also has a production test requiring eye IoU >.90 and muzzle IoU >.97.

## All-source baseline → final policy tradeoffs

Chromium 154.0.8037.57, Linux cloud; single-run engine times, no downscaling.
RGBA MAE uses premultiplied channels 0–255 against the actual encoded/blended source.
Geometry metrics compare known clean ground truth where available; improvements can
therefore coexist with increased source MAE. Extra metrics in full.json: global luma
SSIM (one global window, **not** multiscale SSIM), sampled CIE76 Lab delta-E on subject
pixels, eye/ear/muzzle measures, holes, paths, explicit anchor endpoints/control points,
SVG bytes, stage config, timings and allocated WASM linear memory. Endpoint counts
include repeated endpoints, excluding close commands; control points are separate.

| Source | Edge F1 | Source RGBA MAE | Paths | SVG bytes | Anchor endpoints / controls after | Engine ms |
|---|---|---|---|---|---|---|
| quality/cat-128-opaque.png | 0.998 → 0.998 | 1.208 → 1.204 | 5 → 5 | 1826 → 1906 | 63 / 114 | 9.6 → 36.9 |
| quality/cat-512-opaque.png | 0.980 → 0.980 | 0.818 → 0.818 | 5 → 5 | 3497 → 3497 | 112 / 212 | 59.9 → 83.8 |
| stage12/cat-128-blended.png | 0.893 → 0.998 | 2.275 → 2.662 | 7 → 13 | 2450 → 4588 | 179 / 288 | 4.7 → 22.8 |
| stage12/cat-128-lossy.jpg | 0.948 → 0.948 | 2.713 → 2.708 | 28 → 28 | 4844 → 4874 | 190 / 324 | 6.9 → 9.7 |
| stage12/cat-128-lossy.webp | 0.997 → 0.997 | 2.373 → 2.372 | 9 → 9 | 2455 → 2474 | 87 / 156 | 5.6 → 7.1 |
| stage12/cat-512-blended.png | 0.827 → 0.999 | 0.976 → 0.979 | 9 → 13 | 6269 → 12977 | 465 / 864 | 72.5 → 79.1 |
| stage12/cat-512-lossy.jpg | 0.980 → 0.976 | 1.094 → 1.095 | 77 → 77 | 19712 → 19814 | 801 / 1410 | 89.0 → 77.5 |
| stage12/cat-512-lossy.webp | 0.974 → 0.974 | 1.043 → 1.045 | 34 → 34 | 9229 → 9223 | 342 / 610 | 69.1 → 75.4 |
| quality/cat-128-binary.png | 1.000 → 1.000 | 1.965 → 1.961 | 4 → 4 | 1559 → 1639 | 53 / 96 | 2.4 → 2.8 |
| quality/cat-128-partial.png | 1.000 → 1.000 | 3.521 → 3.517 | 4 → 4 | 1544 → 1624 | 52 / 94 | 2.1 → 2.8 |
| stage12/openmoji-cat-128.png | 0.775 → 0.775 | 6.496 → 6.498 | 15 → 15 | 5377 → 5377 | 196 / 362 | 3.9 → 6.1 |
| stage12/openmoji-cat-512.png | 0.652 → 0.652 | 1.858 → 1.858 | 14 → 14 | 11849 → 11849 | 400 / 770 | 37.5 → 47.1 |
| icon.png | 0.995 → 0.995 | 0.606 → 0.606 | 3 → 3 | 1113 → 1113 | 35 / 64 | 3.2 → 4.0 |
| corners.png | 0.997 → 0.997 | 1.815 → 1.815 | 3 → 3 | 1689 → 1689 | 56 / 106 | 5.4 → 6.6 |
| curves.png | 1.000 → 1.000 | 1.732 → 1.732 | 3 → 3 | 798 → 798 | 21 / 36 | 3.7 → 4.5 |
| illustration.png | 0.998 → 0.998 | 1.208 → 1.204 | 5 → 5 | 1826 → 1906 | 63 / 114 | 3.7 → 5.6 |
| illustration.webp | 0.989 → 0.989 | 2.079 → 2.081 | 12 → 12 | 2853 → 2875 | 103 / 182 | 4.3 → 5.3 |
| lineart.png | 0.965 → 0.965 | 3.410 → 3.410 | 8 → 8 | 2756 → 2756 | 97 / 178 | 4.0 → 5.1 |
| gradient.jpg | N/A | 8.480 → 8.480 | 223 → 223 | 80811 → 80811 | 3773 / 7092 | 50.4 → 54.0 |
| transparent.png | 1.000 → 1.000 | 0.000 → 0.000 | 1 → 1 | 369 → 369 | 10 / 16 | 1.9 → 2.7 |

The 512px JPEG has a small contour-score regression; shared-boundary candidates and
low-precision denoise do not win universally. Original eight assets retain prior
structural/pixel gates; Photo has no new smoothing or cleanup. At 400% some contours
still have facets/bumps and ears may be rounded on blended sources. We do not claim
"no jagged shapes on every input" or ideal ellipse reconstruction from arbitrary blur.

### Upstream blind fidelity reuse

The existing upstream crates/vtracer-bench was inspected and built at the same source
commit (package 1.0.0-alpha.6 at that revision, dssim-core 3.4.0). Its CLI scored 30
opaque reconstructions. This is a supplemental blind scorer, not a tracing dependency.
For this RGB-only tool, both original and reconstruction are flattened on the same
white background; the separate strict RGBA metrics above retain alpha defects.
Transparency cases are excluded from its score. It reports multiscale DSSIM/SSIM,
PSNR and coherent missing-patch mass; the raw output is retained, not re-labelled as
our global-luma proxy or a Vector Magic similarity percentage.

| Opaque source | Upstream fidelity before → after | Upstream SSIM before → after |
|---|---|---|
| quality/cat-128-opaque.png | 0.8986 → 0.8985 | 0.99710 → 0.99707 |
| stage12/cat-128-blended.png | 0.7319 → 0.8088 | 0.99270 → 0.99585 |
| stage12/cat-128-lossy.jpg | 0.7737 → 0.7755 | 0.99464 → 0.99469 |
| stage12/cat-128-lossy.webp | 0.8284 → 0.8284 | 0.99478 → 0.99480 |
| stage12/cat-512-blended.png | 0.8783 → 0.9287 | 0.99695 → 0.99919 |
| gradient.jpg | 0.0006 → 0.0006 | 0.92923 → 0.92923 |

## Desktop cold/warm evidence and memory limits

Same image, same auto profile, same actual SVG output: the dedicated browser test
compares two runs and verifies only one WASM request. Reset must load WASM again.
The numbers below are observations from that run; not medians, sustained benchmarks
or a prediction of Android behavior. JIT and scheduler effects also change trace time.

| Run | Decode ms | Engine initialization ms | Segmentation ms | Downstream ms | Worker total ms |
|---|---:|---:|---:|---:|---:|
| Cold | 12.40 | 17.00 | 22.20 | 16.70 | 63.60 |
| Warm | 20.30 | 0.00 | 1.60 | 5.80 | 8.10 |
| After Reset | 22.90 | 11.50 | 8.70 | 16.80 | 42.80 |

Observed research WASM linear memory ranged 1.62–25.94 MiB during this
sequential 128/512px experiment. This is allocated linear memory, not total JS buffers,
process peak RSS, or an isolated per-algorithm memory comparison. Worker reuse retains
the high-water allocation until reset/cancel/unmount/30s idle. The application WASM is
now about 279kB versus about 183kB at Stage 1.1; cold mobile transfer/compilation needs
real-device validation. Source caps remain 10 MiB, 16MP decode, 2MP trace with explicit
resize consent. No silent resize was added. Original decode can use ~64MB, plus RGBA,
WASM and clustering allocations.

**Physical Android cold/warm/runtime/memory: NOT VERIFIED.** No device/ADB access was
available. A mobile viewport test cannot substitute for it. On a physical device,
repeat the same input/preset before Reset for warm timing, then Reset for cold timing,
record diagnostics and Chrome memory data, and retain the original/SVG privately.
No claim that Android slowness is resolved, and no hosted URL is invented.

## Reproduction and artifacts

```bash
# Activate Rust/Node per README, repository root.
npm ci
node scripts/stage12-fixtures.mjs
npm run build:wasm
npm run lint
npm run typecheck
npm run test
npm run build
NEXORA_CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e
NEXORA_CHROMIUM_PATH=/usr/bin/chromium node scripts/stage12-screenshots.mjs
# Offline research (port 4195; production assets stay separate):
bash scripts/stage12-research.sh
NEXORA_CANDIDATE=policy bash scripts/stage12-research.sh --full
node scripts/stage12-upstream-score.mjs
```

For the last command, set NEXORA_UPSTREAM_BENCH to a built vtracer-bench binary from
the pinned source (cargo build -p vtracer-bench --release -j 2). Current instance binary:
/workspace/nexora-upstream-vtracer/target/release/vtracer-bench. The benchmark is not
needed for application development or CI. Local validation used NEXORA_TEST_PORT=4174
because 4173 was occupied; the configurable default remains 4173. On research reruns,
copy full.json before trying a different NEXORA_CANDIDATE to preserve each comparison.

Actual generated artifacts, ignored by Git:
- benchmark-results/stage12/matrix.json: initial 65 traces.
- adaptive.json, cutout.json, denoise.json, watershed96.json: paired rejected/refined trials.
- full.json: final 40 paired traces across 20 sources, including original eight fixtures.
- upstream-fidelity.json: original upstream CLI output for 30 opaque reconstructions.
- production.json, cold-warm.json: actual UI worker geometry/timing assertions.
- *-baseline.svg and *-policy.svg plus PNG rasters: exported independent research results.
- quality-cat-128-opaque.png-100.png / -400.png, stage12-cat-128-blended.png-100.png /
  -400.png and stage12-cat-128-lossy.webp-100.png / -400.png: Chromium screenshots of
  original | actual Stage 1.1 SVG | actual Stage 1.2 SVG at fixed matching scales.
- test-results/stage12-*/: production screenshots and original download SVG artifacts.

CI already discovers the new browser tests and archives test-results/ and
benchmark-results/. It regenerates production evidence and the 100%/400% comparison composites; expensive offline matrices
are explicit research commands. Raw generated scores/screenshots are not committed.
A successful local run does not establish a successful remote GitHub Actions run.
Public Vector Magic tutorials remain a behavioral reference; network access was
previously denied and no competitor code/assets/output were acquired.

## Validation and acceptance accounting

- PASS: production WASM build, lint, typecheck; **22 unit tests, 9 browser tests**.
- PASS: prior opaque/binary IoU, hole, face-feature and connected-ear gates retained;
  SVG is real geometry, no bitmap embedding or stroke cover-up.
- PASS: measured eye-shape improvements on clean/compressed fixtures and materially
  improved blended-edge contour scores; baseline and experimental modes remain selectable.
- PASS: licensed artwork added with full attribution and separate alpha status.
- PASS: one trace per click; warm engine reuse, stale errors/replies, cancellation,
  reset and idle cleanup; unchanged consented resolution caps.
- PARTIAL: not every eye/muzzle/ear contour is ideal at 400%; the licensed partial-alpha
  sample still needs explicit shared mode for its larger contour improvement.
- FAIL / UNSUPPORTED: faithful partial alpha, including the earlier 128px .98 target.
  The application explicitly warns; that target was not waived or reclassified as passed.
- NOT VERIFIED: owner's exact raster/SVG, physical Android speed/peak memory, remote CI,
  GitLab Pages deployment, vector-editor compatibility, competitor parity.

Changed subsystems: Rust binding/fitter selection and stage timing; diagnostics/adapter;
worker lifecycle; decode/result timing and contour UI; geometry/performance tests;
fixture provenance and offline research/scoring tools. Vendor sources and production
fallback tracing parameters unchanged. Commit: see git log for the issue #2 Stage 1.2
implementation commit; this report is committed with the source. Issue remains open
until external/device evidence and remaining quality criteria are satisfied.
