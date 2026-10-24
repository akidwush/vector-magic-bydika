# Stage 01 implementation notes / ADR

Historical Stage 1 baseline below. Stage 1.1 supersedes precision 6/7 with 5 for
Logo/Illustration, and fallback palette/stroke settings. See STAGE_01_QUALITY_HOTFIX_REPORT.md.

## Audit and authorization

Starting remote main: `0c6b6976c0c270e58adbc2e605363d0acc557f22`.
The initially unborn local checkout was empty; the remote subsequently gained Stage 0.
Fetched `main`, created local `main` from FETCH_HEAD, preserved all Stage 0 documents
and archived landing files. There were no pre-existing local source changes.
Owner explicitly requested direct work on main, overriding the preferred feature-branch workflow.
Native Git read and push dry-run succeeded. GitHub Actions API inspection was denied
by the network proxy; a present GH_TOKEN binding was not printed or replaced.

Before implementation: documentation, historical validation script, placeholder
landing, GitHub document-check workflow, and placeholder GitLab pipeline only.
Added: functional React application, Rust/WASM binding, vendored upstream core,
fallback adapter, worker lifecycle, safety checks, fixtures, unit/browser tests,
real benchmark harness, build and CI. No original tracing algorithm was written.

## Engine decision

VTracer main now uses a Rust 2024 workspace, version 1.0.0-alpha.4; its old webapp
is explicitly superseded. The current core has no file I/O and accepts ColorImage.
The Node wrapper's RGBA interface was inspected, but its JS filesystem layer is not imported.
A small wasm-bindgen `trace` wrapper calls `Config::build().to_svg()` on upstream core.
Core source is vendored unchanged; only its Cargo manifest is flattened from workspace
inheritance for an independently reproducible build. Exact provenance is in UPSTREAM_LOCKFILE.md.
Vendoring avoids downloading a mutable Git branch and includes only the core, not CLI,
Node wrapper, upstream assets, or webapp. Future core updates require intentional revision,
license review, and benchmark reruns. The integration is pinned to an alpha release;
API stability is not assumed.

Rust 1.99.1, wasm32-unknown-unknown and wasm-bindgen-cli 0.2.126 are pinned.
Build: `npm run build:wasm` uses `cargo build --locked --release -j 2`, then
`wasm-bindgen --target web`. Vite emits and locally serves the actual WASM file.
No wasm-pack or runtime CDN is required. Chromium browser tests prove execution.

ImageTracerJS 1.2.6 is a real fallback and explicit diagnostic selection. It is
loaded only on request or WASM initialization failure. Trace errors do not trigger
silent retries with another engine. Fallback uses deterministic grid color sampling;
uniform palette sampling produced visible artifacts during development and was replaced.
Default 1px color-matched strokes are retained to close fallback region seams; they can slightly thicken boundaries. Both engines run inside a single disposable worker. Cancellation terminates the worker;
request IDs reject obsolete results. Worker initialization and decode are included in
UI total time, separately from engine tracing time. No fake progress percentages.

SVGO 4.1.0 research confirms a browser export exists. It is deliberately deferred:
VTracer already serializes compact paths, and additional optimization would complicate
baseline attribution without being required for editable SVG.

## Presets: actual VTracer options

| Setting | Logo | Illustration | Photo |
|---|---:|---:|---:|
| color_precision | 6 | 7 | 8 |
| max_colors | 8 | 24 | 64 |
| filter_speckle (side length) | 2 | 2 | 4 |
| mode | Polygon | Spline | Spline |
| layer_difference | 16 | 16 | 24 |

Other values use this exact core's defaults (corner_threshold 60°, length_threshold
4, max_iterations 10, splice_threshold 45°, stacked compositing, path precision 2,
optimization 1). Logo emphasizes compact straight boundaries; Illustration uses
spline curves and a wider palette; Photo preserves more color detail. Photo is not
photorealistic reconstruction. `max_colors` is upstream quantization, not a guarantee
that arbitrary output always contains exactly that number of fill colors.

Fallback maps colors to 8/24/64, pathomit to 4/4/16, ltres to 1/0.5/0.5,
qtres to 1/1/0.5, colorsampling 2, roundcoords 2, strokewidth 1. Fallback results and
alpha behavior differ from VTracer; diagnostics identify the active engine.

## Safety and limits

Input limits: 10 MiB encoded, 16 MP header-validated source, 2 MP effective tracing.
Header parsing covers PNG, JPEG SOF and WebP VP8/VP8L/VP8X. Browser decode is an
additional verification step, preserves EXIF orientation, and checks decoded pixel count.
Native bitmap memory can reach about 64 MB before downscaling; effective RGBA is
at most 8 MB, plus worker, WASM, clustering and other browser allocations. These are
buffer estimates, not measured peak-memory guarantees. Resize requires explicit consent.

The original file remains local. SVG is parsed, restricted to inert geometry and
presentation attributes, validated for dimensions, and previewed using an img Blob URL.
No raw SVG HTML injection, external references, raster embedding, or remote uploads.
Object URLs, workers and bitmaps are released on completion/replacement/reset/unmount.
Fully transparent input may produce no geometry and is reported as an error.
Partial alpha, animated image behavior, low-memory physical phones, and large
complex images need further validation; no promise of arbitrary input performance.

## References and infrastructure

Vector Magic tutorial URLs from the specification remain quality references only.
The public tutorial request was blocked by proxy HTTP 403; no proprietary code,
competitor assets, private endpoints, or comparative output were used.
Playwright browser download was also blocked. The existing `/usr/bin/chromium`
was used instead, through NEXORA_CHROMIUM_PATH. No verification bypass was used.
GitLab access/project binding was absent; deployment is prepared, not performed.
