# NEXORA Vector Engine

**Local image → editable SVG.** Stage 1 browser converter with VTracer Rust/WASM,
a tested ImageTracerJS fallback, three presets, original/vector comparison and local download.
No account, tracing API, server upload, or paid runtime. Not affiliated with Vector Magic.
Quality equivalence is not claimed; Photo is a baseline, and clean-vector improvement is future work.

## Stage 1.2 — contour quality and worker startup

[Issue #2 evidence, measurements and remaining failures](docs/STAGE_01_2_REPORT.md).
The current review branch adds bounded local coverage fitting to upstream contours.
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
No Inkscape verification or Vector Magic comparative benchmark has been performed.

## Hosting and licenses

[GitLab Pages instructions](docs/DEPLOY_GITLAB_PAGES.md) describe the prepared free static
pipeline. A GitLab project/access is required for an actual deployment; no production URL exists yet.
The GitHub and GitLab pipelines build WASM, run checks and publish evidence.

The owner has not selected a license for original NEXORA code. Third-party licenses
remain intact; see [upstream lock](docs/UPSTREAM_LOCKFILE.md) and THIRD_PARTY_NOTICES.txt,
which is included in the build. Fixture artwork is separately dedicated to CC0-1.0.
