# Stage 01 Report

## Status

**PARTIAL overall; local conversion workflow PASS.** The real browser application,
WASM execution, SVG download, static build, tests and baseline are verified locally.
GitLab deployment and remote CI status remain unverified. No claim of 100% completion,
Vector Magic equivalence, or physical Android validation.

## Git

- Branch: main, per owner's explicit latest instruction; no feature branch or PR.
- Starting commit: 0c6b6976c0c270e58adbc2e605363d0acc557f22.
- Implementation commits: see `git log --oneline` (engine integration; app/tests/CI/docs).
- Stage 0 documents and landing preserved; obsolete hosting/README assertions migrated.
- No reset of remote history or force-push. Native Git read and push dry-run verified.

## Actual engine

- VTracer browser WASM: **PASS**, active default, not the Node JS wrapper.
- Upstream: 1.0.0-alpha.4 at e71343fbcbf469b8a72a255030408a39939162eb.
- ImageTracerJS 1.2.6 fallback: **PASS**, automatic on WASM initialization failure and
  explicitly selectable; actual tracing tested with PNG and WebP.
- SVGO: evaluated; intentionally not integrated.
- MIT/Unlicense and transitive redistribution notices retained. Original NEXORA
  project-wide license remains undecided by owner; fixture artwork separately CC0.

## Verified features

- Real PNG/JPEG/WebP upload, MIME/signature/header/decode checks and source caps.
- Three distinct presets using actual upstream parameters.
- Worker tracing, termination cancellation, stale-job rejection and resource cleanup.
- Consent before downscaling, effective resolution shown; 2.2 MP → 1906 × 1048 tested.
- EXIF orientation: generated JPEG 64 × 32 with orientation 6 produces 32 × 64 output.
- Original/vector side-by-side, slider, zoom and fit.
- Local SVG Blob download with real editable paths, dimensions/viewBox and safe preview.
- Engine/version, trace-only time, total conversion time, SVG bytes and path count.
- No external HTTP image requests observed during the full WASM fixture run.
- Form labels, keyboard focus styles, live error/status feedback; 390px viewport
  checked for horizontal overflow. This is not a full accessibility audit.

## Test results

- Frozen `npm ci`: PASS; setup repeated from the saved installation commands.
- Rust/WASM compile and binding generation: PASS; no bypass of checksums or TLS.
- Lint/typecheck: PASS.
- Unit: **18 passed**, no skipped tests.
- Browser: **4 passed**, real Chromium 154.0.8037.57 / Playwright 1.64.1.
- Browser scenarios include 24 WASM conversions, forced/automatic fallback, cancelled
  jobs, reset/replacement, Blob revocation, malformed input, downscale consent,
  EXIF orientation, comparison, zoom, download and local-only network behavior.
- Browser serves built static files under `/nexora/`, with WASM MIME application/wasm.
- Mobile: **emulated viewport**, not physical Android.
- Historical Stage 0 file audit: PASS; not counted as tracing validation.
- Production build: PASS, actual WASM asset 178,403 bytes plus worker/JS/CSS/notices.
- Runtime dependency npm audit: 0 vulnerabilities reported at audit time.
- GitHub CI: configuration upgraded; remote status **UNVERIFIED**, API request blocked
  by network HTTP 403. Local results are not a claim of remote CI success.
- GitLab CI: prepared but **NOT RUN**, no GitLab project/access binding available.

## Benchmark and evidence

[Measured baseline](STAGE_01_BENCHMARK.md): 8 files, 7 self-authored categories,
3 presets each, 24 real SVG exports/rasterization comparisons. Actual screenshots,
exported SVG and raw observations are in ignored test-results/ and benchmark-results/;
CI is configured to retain artifacts. Per-run timing is a baseline, not a phone SLA.
No node-count, peak-memory, Inkscape, or competitor-comparison claim.

## Hosting and cloud environment

- Static build generated: **YES**. Historical landing is not the build output.
- GitLab Pages deployment: **NOT CONFIGURED**, no verified production URL.
- GitHub remains canonical; .gitlab-ci.yml publishes dist/ after validation succeeds.
- Reusable cloud install/start instructions are saved separately in environment settings;
  saving is not publication, runtime restart, or proof of a restored new task.
- The environment uses existing Chromium rather than downloading a blocked browser.
  No extra browser-download domains are required for the prepared machine.

## Remaining issues, by impact

1. Quality: thin features, anti-alias handling, corners and gradients require Stage 2
   tuning. Photo posterizes and may generate larger SVGs than original compressed images.
2. Device resilience: no physical Android or low-memory test, measured peak memory,
   broad partial-alpha/animation coverage, or large-complex-image performance guarantee.
   Bitmap decode can occupy ~64 MB; engine allocations are additional.
3. Fallback: different quality/alpha behavior and often many more paths. Color-matched
   1px strokes reduce white seams but can thicken shapes. A WebP fallback raster diff
   is tested against a smoke threshold; this is not comprehensive quality certification.
4. Delivery: GitLab project/access and live deployment verification remain outstanding;
   remote GitHub CI needs review through the repository's Actions UI or permitted API access.
5. Reference review: Vector Magic public tutorial fetch was blocked; no reference
   outputs were acquired. This does not prevent baseline local conversion.
6. Long-term provenance: upstream core is alpha and must be upgraded intentionally;
   original project licensing is still undecided.

## Definition of done evidence

- [x] Stage 0 audit and preservation.
- [x] Open-source engine integration, exact provenance, actual browser WASM.
- [x] Real PNG/JPEG/WebP → vector SVG and three functional presets.
- [x] A/B comparison, local download, input caps, cleanup and errors.
- [x] Responsive mobile emulation and reproducible baseline exceeding six fixtures.
- [x] Unit/typecheck/lint/build and browser smoke locally pass.
- [x] GitHub Stage 1 workflow and GitLab real-app Pages pipeline prepared.
- [ ] Remote GitHub CI success independently verified.
- [ ] GitLab CI and production deployment verified.
- [ ] Physical Android and vector-editor validation (not available locally).

## Next stage

Prioritize thin-line retention, color-region seams, anti-aliased corners and compact
paths; expand legal fixtures and run controlled regression comparisons. Then test
physical Android memory/performance and complete live GitLab Pages verification.
