# NEXORA Vector Engine

**Local image → editable SVG.** Stage 1 browser converter with VTracer Rust/WASM,
a tested ImageTracerJS fallback, three presets, original/vector comparison and local download.
No account, tracing API, server upload, or paid runtime. Not affiliated with Vector Magic.
Quality equivalence is not claimed; Photo is a baseline.

## Stage 1.6E — source-verified sharp apex research

The experimental already-G0 fallback fits incident handles jointly at a
source-supported apex. Triangle 8° at 512px maximum error improves from
2.255 to 0.985px; the protected Stage 1.6D exports remain identical. Triangle
128 still requires an uncertified movement beyond the unchanged trust bounds
and stays unresolved. Normal Auto is unchanged.
[Diagnostics, measured results and actual exports](docs/STAGE_01_6E_SHARP_APEX_REPORT.md).

## Stage 1.6D — source-verified continuity research

The experimental recovery now rejects source-disproved short spline splices.
Wave 128 false G0 corners drop from eight to zero, with p95 boundary error
0.425 → 0.085px and preserved true-corner recall. The protected Stage 1.6C
exports remain identical. Already-sharp triangle recovery improves at 1024px;
128/512 and other uncertain cases remain unresolved. Normal Auto is unchanged.
[Measured results, SVGs, visual evidence and limitations](docs/STAGE_01_6D_FALSE_CORNER_RECOVERY_REPORT.md).

## Stage 1.6C — low-resolution acute geometry research

The follow-up research feature recovers source-supported acute caps on final
reduced knots. Cubic 128/512 maximum boundary error improves from about 3.47px
to 0.82px; the verified Stage 1.6B exports remain unchanged. Wave 128 improves
its corner and maximum error, while its p95 and existing crest artifacts remain
limited. Ambiguous, nearly parallel and clipped shapes retain the baseline.
Normal Auto is unchanged; this still requires the experimental `source_geometry`
build. [Scope, evidence and remaining failures](docs/STAGE_01_6C_LOW_RESOLUTION_GEOMETRY_REPORT.md).
The research runner saves a new artifact directory per run and retains the
existing quality gates alongside cross-resolution browser comparisons.

## Stage 1.6B — source geometry research

The follow-up `source_geometry` Cargo feature refines final reduced contours:
it excludes ambiguous wedge pixels, calibrates sharp intersections from the
source, and rolls back individual spans when coverage or exported-paint error
increases. It is excluded from normal builds and does not change Auto.
[Recovery design, actual export metrics and limitations](docs/STAGE_01_6_SUBPIXEL_INVERSION_REPORT.md).
`bash scripts/source-target-research.sh` rebuilds both historical baselines and
the candidate, runs browser/export checks, and fails on the unchanged quality gate.

## Stage 1.5 — experimental source refinement

Stage 1.5 adds `Refinement sumber · uji`, disabled by default,
for eligible opaque PNG illustrations. It uses source coverage to repair poor
free-form initialization and refine local Bézier handle lengths. Promotion is
controlled by an explicit source/reference geometry gate, including acute tips
and final-output corners. Low-resolution caps and clipped contours remain limited. [Measured results and limitations](docs/STAGE_01_5_SOURCE_CONSTRAINED_BEZIER_REPORT.md).

## Stage 1.4 — bounded node optimization

Eligible Auto contours reuse VTracer/flo_curves fitting with protected corners,
two-sided distance checks and topology rollback. Shared boundaries are optimized
once in their existing edge cache; exactly straight cubics export as lines.
`Optimalkan node` is enabled by default; uncheck it to reproduce the previous
engine geometry. Dense circles and some rounded contours improve measurably;
complex curves and region fragmentation remain open quality work.
[Actual measurements, visual artifacts and remaining failures](docs/STAGE_01_4_CURVE_OPTIMIZATION_REPORT.md).

## Source-guided contour quality

Auto now uses local two-color evidence and source-verified geometry for eligible
flat PNGs: sharper polygon corners, smoother circular eyes and fewer antialias
fragments. Original RGBA remains the fitting reference; partial alpha retains
vector opacity masks. Photo, compressed/complex inputs and uncertain cases keep
the previous routes. `Pembanding Auto lama` reproduces the exact prior Auto policy.
[Measured results, comparisons and limitations](docs/SOURCE_GUIDED_QUALITY_REPORT.md).
The locked shared-edge profile remains available and independently validated;
Auto is not a universal planar-graph or Vector Magic quality guarantee.

## Stage 1.2 — contour quality and worker startup

[Issue #2 evidence, measurements and remaining failures](docs/STAGE_01_2_REPORT.md).
Stage 1.2 adds bounded local coverage fitting to upstream contours.
It compares encoded-sRGB and linear-light hypotheses and preserves ambiguous regions.
Partial-alpha flat art uses editable vector opacity contours (quantized, not exact
continuous alpha); Photo/fallback limitations remain explicit.
The default contour policy uses upstream spline fitting on disk-like components;
blended opaque flat art uses shared boundaries. Baseline Stage 1.1 remains selectable.
Diagnostics show heuristic input class, alpha coverage, effective profile and stage times.
The 128px partial-alpha regression now requires IoU >=0.980 in both browser and
independent rendering. Continuous-alpha fidelity is still not guaranteed.
Workers are reused between completed jobs and released on cancel/reset/unmount or
30 seconds idle. Images remain local and each click performs one trace.
No Android-device speed or full Vector Magic parity is claimed.

## Quality hotfix 1.1

Logo/Illustration use upstream precision 5 before segmentation for statistically flat
inputs; complex inputs retain precision 6/7 and Photo retains 8. Effective precision
is shown in result metadata. ImageTracerJS
uses a source-derived palette for these presets and no stroke cover-up.
[Hotfix evidence and remaining failures](docs/STAGE_01_QUALITY_HOTFIX_REPORT.md)
include pixel gates, before/after comparisons and unresolved partial-alpha behavior.
The exact user image remains unverified until the original raster and exported SVG are supplied.

## Status

Local production build and Chromium workflow verified; see [Stage 1 report](docs/STAGE_01_REPORT.md)
and [measured baseline](docs/STAGE_01_BENCHMARK.md). GitLab hosting is **not configured or deployed**.
GitHub main remains canonical. Historical Stage 0 docs and landing/ are retained;
landing/ is an archived placeholder and is not the application build target.

## Develop

Prerequisites: Node 24.19.0 (minimum 24.15.0 for the selected tools), Rust
1.99.1 with wasm32-unknown-unknown, and wasm-bindgen-cli 0.2.126.
From the repository root:

```bash
rustup toolchain install 1.99.1 --profile minimal --target wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.126 --locked
npm ci
npm run build:wasm
npm run dev
```

Generated WASM is ignored; build it before typechecking, testing, or Vite builds.
Browser assets (including WASM) are bundled locally; no runtime CDN is used.
Live processes must restart after cloud snapshot restoration. Use the existing checkout;
cloud tasks are already isolated and do not require a worktree.

## Checks and benchmark

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
```

If Chromium is already installed, skip the download and use
`NEXORA_CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e`.
Browser tests serve actual dist/ at `/nexora/` to verify project-subpath JS/worker/WASM
loading. They exercise real engines, download, mobile layout, cancellation, malformed
files, consented downscaling and resource cleanup. They produce screenshots, SVG exports
and raw benchmark observations in ignored test-results/ and benchmark-results/.
CI retains these artifacts. `node scripts/fixtures.mjs` regenerates the self-authored fixtures.

## Limits and architecture

PNG/JPEG/WebP, maximum 10 MiB and 16 MP source. Tracing is capped at 2 MP; larger
sources require explicit downscaling consent. Original bitmap can occupy ~64 MB,
tracing RGBA ~8 MB; engine memory is additional and not a guaranteed mobile peak limit.
All heavy tracing runs in a disposable worker. Cancel terminates that worker.
SVG must pass structural/security validation before preview and download.

Three presets map to real engine settings; mappings, fallback behavior, provenance,
alpha limitations and decisions are in [implementation notes](docs/STAGE_01_IMPLEMENTATION_NOTES.md).
Android-size viewport tests are emulation, **not physical Android-device tests**.
Inkscape 1.4 CLI import/plain SVG roundtrip and PNG export were verified on four
Stage 1.4 fixtures; GUI anchor editing and Illustrator remain unverified.
No comparative Vector Magic benchmark has been performed.

## Hosting and licenses

[GitLab Pages instructions](docs/DEPLOY_GITLAB_PAGES.md) describe the prepared free static
pipeline. A GitLab project/access is required for an actual deployment; no production URL exists yet.
The GitHub and GitLab pipelines build WASM, run checks and publish evidence.

The owner has not selected a license for original NEXORA code. Third-party licenses
remain intact; see [upstream lock](docs/UPSTREAM_LOCKFILE.md) and THIRD_PARTY_NOTICES.txt,
which is included in the build. Fixture artwork is separately dedicated to CC0-1.0.

### Stage 1.2B: locked shared edges

Select **Shared edge · locked graph (eksperimental)** to use the validated upstream
Mosaic graph route. Each internal boundary is fitted/quantized once and reused in
reverse by its neighbor. Auto retains Stage 1.2 routing. Real geometric cracks are
removed on the test corpus, but SVG antialias hairlines and some pixel fallbacks
remain; this is not a universal visual-gapless claim.

See [the shared-edge report](docs/STAGE_01_2_SHARED_EDGE_REPORT.md) for geometry,
renderer, feature and runtime comparisons at 100%, 400% and 1000%.

Stage 1.6F research adds an opt-in `large_apex` Cargo feature (implies
`source_geometry`) for separately source-certified large apex corrections.
Ordinary 3px/3.5px validation is retained and reported independently. This is
experimental, does not change Auto or shared-edge composition, and is not enabled
in normal WASM builds. The isolated research runner retains all historical gates
and compares the extended contract against Stage 1.6E exports.

[Stage 1.6F measured report](docs/STAGE_01_6F_LARGE_APEX_RECOVERY_REPORT.md):
Triangle 128 maximum boundary error 5.154 → 0.410px, corner precision/recall 1/1,
14 anchors retained; all 44 other corpus exports unchanged. Both implementation
CI runs pass. Local runtime gates still fail on recorded historical/protected
cases, so local validation remains PARTIAL and the feature stays experimental.

Stage 1.6G runtime research adds fixed-size `runtime_profile` diagnostics and
A/A, A/B, cold/warm and Worker-reset distributions without replacing old gates.
The bounded exact-area `runtime_cache` prototype is opt-in: measured work savings
and Cubic improvements do not establish a universal speedup. Ordinary
`source_geometry`/`large_apex` retain their previous scoring path. Physical
Android performance remains unverified; runtime stabilization is research-only.

[Stage 1.6G runtime report](docs/STAGE_01_6G_RUNTIME_STABILIZATION_REPORT.md):
PARTIAL. A/A/A/B data and profiling are retained, 45 F/G SVGs are byte-identical,
and cache work savings do not establish a universal speedup. The local historical
thin-ellipse runtime gate remains FAIL; the complete c6cda33 CI passed. See the
report for later workflow status and the unverified physical Android procedure.

### Stage 1.6H research — inverse hot path

The opt-in `inverse_hotpath` feature preserves all 45 Stage F SVG exports byte for byte. Ordered row constants, stack clamp knots and exact local flatten reuse reduce redundant CPU work. Wave 512/1024 improve in all three paired Worker sessions; Cubic and small-input latency remain mixed. **PARTIAL:** the local historical runner fails its unchanged sharp-apex +500ms gate on a clipped 1024px blade, and the separate H/E runtime gate fails six cases. No global activation or merge. See [measured results and retained failures](docs/STAGE_01_6H_INVERSE_HOTPATH_REPORT.md).
