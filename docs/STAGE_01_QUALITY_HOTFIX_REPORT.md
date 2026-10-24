# Stage 1.1 quality hotfix report

Historical baseline. Stage 1.2 changes and measured regressions are in [STAGE_01_2_REPORT.md](STAGE_01_2_REPORT.md).

## Status: PARTIAL — representative flat-color improvement verified

User's exact failing raster and exported SVG: **NOT VERIFIED**, neither was supplied.
This report does not claim to reproduce or solve that exact case. Please supply both
files to establish active engine, preset, encoding, alpha and geometry for that case.

Started from clean main `0e998a11075965f6ace612074ce648ac82c18d60`; remote main matched.
Owner's earlier direct-main instruction retained. GitHub Actions API inspection was
attempted with existing authentication but denied by network policy (HTTP Forbidden).
No credentials or user files were overwritten. No upstream vendor source changed.
VTracer remains 1.0.0-alpha.4 at e71343fbcbf469b8a72a255030408a39939162eb, MIT;
ImageTracerJS remains 1.2.6, Unlicense. No new dependencies or license changes.

## Confirmed findings versus hypotheses

- **Confirmed:** the existing VTracer default does not reproduce internal pinholes on
  our clean cat. It preserves all facial details. Lossy encoding increases regions:
  original benchmark WebP gives 47 paths; precision 5 gives 12 with a small MAE tradeoff.
  Extra antialias/compression regions survive post-segmentation palette reduction.
- **Confirmed:** original fallback produces 655 paths on that WebP, with visually
  fragmented boundaries. Its 1px strokes can conceal geometric gaps. Removing strokes
  alone exposes gaps (largest measured interior component 8 px² in the zero-stroke
  comparator). The source-derived palette reduces fallback to 54 paths without strokes;
  the new exported SVG has no measured interior white/transparent hole >2 px², with
  both eyes and nose retained. Residual boundary artifacts are visible at magnification.
- **Confirmed:** palette cap alone is insufficient. Tests of 6/8/12/24/no cap alter
  paint but do not remove segmentation noise. Speckle increases can lose fine regions;
  retained default side length 2 for Logo/Illustration rather than blindly increasing it.
- **Confirmed:** Cutout improves partial-alpha 128px silhouette IoU from .9600 to .9766,
  but still misses .98 and raises opaque MAE/alpha error. Watershed severely damages
  the partial-alpha case (IoU .3956). Neither is enabled globally.
- **Confirmed:** global precision 5 damages gradients: old gradient fixture MAE rises
  from 8.480 to 32.638, with 223 paths collapsing to one. The final selection rule
  preserves precision 7 there, restoring original output. Photo settings are unchanged.
- **Confirmed limitation:** source keying only handles fully transparent pixels;
  core paint serialization is opaque RGB. Partial-alpha preservation is not guaranteed.
  Both browser rasterization and independent libvips rendering show the discrepancy;
  it is not solely a CSS/preview defect.
- **Unresolved:** which engine and source alpha/compression caused the actual user's
  damaged image; proprietary-reference equivalence; general low-memory mobile behavior.

## Implemented changes

`engine/src/lib.rs` selects precision using a bounded 4096-bin RGB histogram: if eight
4-bit RGB bins account for at least 85% of pixels, Logo/Illustration use upstream
precision 5; otherwise retain 6/7. Photo remains 8. Pixels, resolution and alpha are
not rewritten. This is a conservative color statistic, not AI or a new tracing engine.
The user still chooses the visible preset; effective precision is shown in result metadata.
No blur, silent resize, white background, CSS overlay or stroke cover-up was introduced.
The other VTracer parameters and stacked compositing remain unchanged.

`src/engine/palette.ts` initializes ImageTracer's supported custom palette from source
RGBA: deterministic coarse histogram, merge nearby bins within RGBA distance 48,
retain groups representing >=0.5% of pixels up to preset palette cap. One upstream
quantization iteration; fallback strokes are zero. Photo retains upstream sampling.
This changes palette initialization, not ImageTracer's segmentation/path algorithm.
Rare colors below the threshold can be lost on other art; fallback remains explicitly
identified and is not equal quality to VTracer. Input buffers are not modified.

`tests/e2e/quality.spec.ts` adds real production-browser pixel gates, output-size/path
bounds, eye/nose preservation and connected-ear checks. Six clean opaque/binary
fixtures at 128/512/1024 require IoU >=.98, max interior hole <=2 px², <=12 paths.
Partial-alpha cases are tested for facial retention/holes but **not certified** against
.98: that unmet target is reported below. Fallback PNG/WebP has separate no-stroke,
feature, hole and <100-path gates. Gradient/flat profile selection is directly tested.
Worker lifecycle, stale-job rejection, privacy, safety caps and SVG validation remain.

Nine new CC0 PNG fixtures cover three resolutions and opaque/binary/partial alpha.
JPEG quality 70 and WebP quality 65 counterparts are generated deterministically
in the research harness. Existing eight assets remain unchanged.

## Controlled experiments and all-fixture comparisons

Research: 21 isolated configurations × 7 source/encoding combinations = 147 actual
browser traces, zero runner errors. Values include precision 5/6/7/8, speckle 2/3/4/6,
layer difference 12/16/24/32, palette none/6/8/12/24, polygon/spline, corner 45/60°,
length 2/4, stacked/cutout and ColorCluster/Watershed. Poster-like defaults are compared;
manual pre-palette initialization was investigated for the fallback. No full factorial
or bespoke denoiser was implemented. Rejecting candidates is part of the evidence.

Full validation: 29 source variants × baseline/final selection = 58 traces, including
all existing eight assets and 128/512/1024 cat PNG/encoded variants. Browser: Chromium
154.0.8037.57; Linux cloud, native source resolution, no downscale. Engine times are
single in-page measurements, not a phone-performance guarantee. MAE is premultiplied
RGBA 0–255; IoU uses alpha>=128 for transparent images or nonwhite subject for opaque.
Interior-hole measurement erodes homogeneous orange source fill by two pixels; it
cannot certify arbitrary geometry or every boundary. Eye/nose gates test known source
feature positions. Raw output paths are counted, not claimed as anchor/node counts.

### Existing assets, Illustration: baseline → final

| Source | Precision | MAE | Paths | SVG bytes | Trace ms |
|---|---|---|---|---|---|
| icon.png | 7 → 5 | 0.606 → 0.606 | 3 → 3 | 1113 → 1113 | 4.5 → 3.6 |
| corners.png | 7 → 5 | 2.086 → 1.815 | 4 → 3 | 2345 → 1689 | 6.5 → 7.1 |
| curves.png | 7 → 5 | 1.744 → 1.732 | 3 → 3 | 797 → 798 | 5.9 → 6.4 |
| illustration.png | 7 → 5 | 1.267 → 1.208 | 5 → 5 | 1861 → 1826 | 4.3 → 4.2 |
| lineart.png | 7 → 5 | 3.657 → 3.410 | 12 → 8 | 3423 → 2756 | 5.1 → 4.0 |
| gradient.jpg | 7 → 7 | 8.480 → 8.480 | 223 → 223 | 80811 → 80811 | 48.4 → 44.8 |
| transparent.png | 7 → 5 | 0.000 → 0.000 | 1 → 1 | 369 → 369 | 2.3 → 2.0 |
| illustration.webp | 7 → 5 | 2.055 → 2.079 | 47 → 12 | 8776 → 2853 | 9.4 → 5.8 |

WebP MAE slightly increases while silhouette and complexity improve; gradient is
identical after the selection guard. Clean features retain small errors at 400%;
this is not lossless reconstruction. No unmeasured quality parity is asserted.

### Cat PNG: baseline → final (including remaining failure)

| Source | IoU | MAE | Paths | Largest interior hole px² | Eyes/nose |
|---|---|---|---|---|---|
| quality/cat-128-opaque.png | 0.9839 → 0.9849 | 1.267 → 1.208 | 5 → 5 | 0 | PASS |
| quality/cat-128-binary.png | 0.9829 → 0.9829 | 2.062 → 1.965 | 4 → 4 | 0 | PASS |
| quality/cat-128-partial.png | 0.9600 → 0.9600 | 3.590 → 3.520 | 4 → 4 | 0 | PASS |
| quality/cat-512-opaque.png | 0.9939 → 0.9937 | 0.806 → 0.818 | 5 → 5 | 0 | PASS |
| quality/cat-512-binary.png | 0.9930 → 0.9930 | 0.824 → 0.810 | 4 → 4 | 0 | PASS |
| quality/cat-512-partial.png | 0.9885 → 0.9885 | 1.164 → 1.167 | 4 → 4 | 0 | PASS |
| quality/cat-1024-opaque.png | 0.9969 → 0.9970 | 0.669 → 0.679 | 5 → 5 | 0 | PASS |
| quality/cat-1024-binary.png | 0.9971 → 0.9971 | 0.450 → 0.448 | 4 → 4 | 0 | PASS |
| quality/cat-1024-partial.png | 0.9948 → 0.9948 | 0.623 → 0.621 | 4 → 4 | 0 | PASS |

### Source diagnostics (independent decoder, quantized 4-connectivity)

Low-contrast neighbor fraction counts horizontal nonzero RGB differences <=32 among
all nonzero neighbor differences. It is a noise/AA proxy, not a semantic noise detector.
Connected regions use coarse RGB+binary-alpha labels, not upstream segmentation IDs;
path count is recorded separately. Browser-decoded source alpha/RGB counts are also
in full.json. Independent source-audit values below can differ at partial alpha due
to Canvas unpremultiplication. All raw measurements include dimensions and formats.

| Input | Format | Unique RGB | Zero / partial alpha pixels | Connected bins | Regions <=4 px | Edge proxy |
|---|---|---:|---|---:|---:|---:|
| quality/cat-128-opaque.png | original | 278 | 0 / 0 | 422 | 416 | 0.386 |
| quality/cat-128-opaque.png | webp | 2035 | 0 / 0 | 1066 | 954 | 0.905 |
| quality/cat-128-opaque.png | jpeg | 2706 | 0 / 0 | 1525 | 1363 | 0.932 |
| quality/cat-128-partial.png | original | 193 | 9734 / 333 | 305 | 298 | 0.498 |
| quality/cat-128-partial.png | webp | 2084 | 9734 / 333 | 1180 | 1025 | 0.903 |
| illustration.webp | original | 1774 | 0 / 0 | 1010 | 909 | 0.899 |

## Reproduce and evidence

```bash
# Activate the installed Rust toolchain per README, from repository root.
node scripts/quality-fixtures.mjs
npm run build:wasm
npm run lint
npm run typecheck
npm run test
npm run build
NEXORA_CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e
# Research only: separate feature-gated WASM, not shipped in production.
bash scripts/quality-experiment.sh
bash scripts/quality-experiment.sh --full
node scripts/quality-source-audit.mjs
node scripts/quality-screenshots.mjs
```

Research runner needs dist/ and port 4183; production browser suite defaults to 4173,
with NEXORA_TEST_PORT available if occupied. Research exports live only in ignored
benchmark-results/quality/wasm; production builds do not include `experiment`.

Actual local artifacts (not deployed URLs; generated files are ignored):
- benchmark-results/quality/matrix.json: all candidates and errors (none in recorded run).
- benchmark-results/quality/full.json: 58 final paired runs, browser/independent metrics,
  engine config, timings, dimensions, alpha statistics, bytes, paths.
- benchmark-results/quality/source-audit.json: 29 decoded source diagnostics.
- benchmark-results/quality/browser-before-after-100.png and -400.png: real Chromium
  screenshots, identical WebP original/baseline/final at the same scale.
- benchmark-results/quality/quality-cat-128-opaque.png-webp-{baseline,selected}.svg:
  actual before/after editable vector exports; .png and -ab.png independent raster views.
- test-results/quality-fallback-source-pa-e72a3-ver-up-or-interior-pinholes/:
  actual application fallback screenshots for PNG/WebP.

CI already runs all tests/e2e and retains benchmark-results/ and test-results/ artifacts;
this does not establish remote execution or live hosting. Screenshots were inspected:
clean coherent body fill at 100%, ears and facial details retained, with residual edge
facets/halos visible at 400% and more boundary artifacts in fallback.

## Verification and target status

- PASS: production Rust/WASM build, lint, typecheck, 20 unit tests.
- PASS: seven browser tests, including original Stage 1 smoke cases and added pixel gates;
  final ear-connectivity strengthening was rerun on the three quality tests.
- PASS: clean synthetic opaque/binary cat across all three resolutions, no measured
  interior pinholes >2px², eyes/nose/muzzle and connected ears retained, true vector paths.
- PASS: fallback fragmentation reduced without stroke cover-up; not a universal quality claim.
- FAIL: .98 silhouette target for 128px partial-alpha PNG (about .960); similarly noisy
  encoded variants remain below .98. No false expected-pass conversion of this target.
- NOT VERIFIED: user's exact image/SVG; physical Android, Inkscape, GitLab deployment,
  remote GitHub Actions status, Vector Magic comparative outputs.

Remaining priorities: true partial-alpha semantics, edge/corner fitting at low resolution,
rare-color retention and fallback boundary artifacts, then physical Android validation.
GitHub remains canonical main; no force push, hosted service or paid runtime introduced.
Commit hashes: see git log for the Stage 1.1 hotfix commit; this report and fixtures are
included with the source changes. No generated raw scores or screenshots committed.
