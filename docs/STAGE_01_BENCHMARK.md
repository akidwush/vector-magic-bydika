# Stage 01 measured baseline

Run: 24 October 2026, Linux x86_64 cloud machine, Node 24.19.0, Chromium 154.0.8037.57.
Browser automation through Playwright; 5 logical CPUs, ~34 GB host memory reported.
Not a physical Android test and not a mobile performance prediction.

Engine: VTracer 1.0.0-alpha.4, upstream e71343fbcbf469b8a72a255030408a39939162eb,
Rust browser WASM. Preset parameters: STAGE_01_IMPLEMENTATION_NOTES.md. Each observation
starts a fresh worker, loads its engine, decodes the fixture and validates output.
Trace time is engine-only; total is click handler through validated SVG Blob creation,
including decode and worker initialization, before final React paint. Times are rounded
UI observations in milliseconds, not statistically established performance claims.

Eight files cover seven self-authored CC0 fixture categories, including a WebP encode
of the illustration. All are 128 × 128 px, no downscaling. SVG byte sizes are exact.
For each of 24 runs, download was parsed and rasterized with sharp/libvips at original
resolution. Mean absolute error (MAE) is on premultiplied RGBA, scale 0–255; it is **not**
a Vector Magic similarity percentage. Structural pass requires real geometry, valid
SVG, correct dimensions, no embedded raster, and successful rasterization. Smoke
regression limits are fixture-specific (5/6/6/6/8/35/1/7 respectively), deliberately
above current observations; they are regression guards, not a quality certification.
No anchor/node counts are claimed: path count is not equivalent to node count.

| Fixture | Input bytes | Preset | Trace ms | Total ms | SVG bytes | Paths | RGBA MAE | Structural/guard |
|---|---:|---|---:|---:|---:|---:|---:|---|
| icon.png | 728 | logo | 27 | 97 | 321 | 3 | 0.571 | PASS |
| icon.png | 728 | illustration | 11 | 73 | 1040 | 3 | 0.606 | PASS |
| icon.png | 728 | photo | 21 | 80 | 1040 | 3 | 0.606 | PASS |
| corners.png | 2412 | logo | 29 | 83 | 356 | 3 | 1.780 | PASS |
| corners.png | 2412 | illustration | 21 | 70 | 2272 | 4 | 2.086 | PASS |
| corners.png | 2412 | photo | 27 | 105 | 2272 | 4 | 2.085 | PASS |
| curves.png | 2476 | logo | 32 | 72 | 427 | 3 | 1.487 | PASS |
| curves.png | 2476 | illustration | 22 | 85 | 724 | 3 | 1.744 | PASS |
| curves.png | 2476 | photo | 37 | 83 | 724 | 3 | 1.744 | PASS |
| illustration.png | 2682 | logo | 23 | 70 | 615 | 5 | 1.209 | PASS |
| illustration.png | 2682 | illustration | 28 | 76 | 1788 | 5 | 1.267 | PASS |
| illustration.png | 2682 | photo | 23 | 81 | 1728 | 5 | 1.374 | PASS |
| lineart.png | 3183 | logo | 20 | 68 | 815 | 9 | 3.592 | PASS |
| lineart.png | 3183 | illustration | 22 | 70 | 3350 | 12 | 3.657 | PASS |
| lineart.png | 3183 | photo | 23 | 89 | 2573 | 7 | 3.436 | PASS |
| gradient.jpg | 2662 | logo | 57 | 119 | 7396 | 84 | 24.473 | PASS |
| gradient.jpg | 2662 | illustration | 108 | 171 | 80738 | 223 | 8.480 | PASS |
| gradient.jpg | 2662 | photo | 84 | 127 | 47098 | 99 | 5.491 | PASS |
| transparent.png | 708 | logo | 18 | 56 | 181 | 1 | 0.000 | PASS |
| transparent.png | 708 | illustration | 23 | 82 | 296 | 1 | 0.000 | PASS |
| transparent.png | 708 | photo | 21 | 86 | 296 | 1 | 0.000 | PASS |
| illustration.webp | 1120 | logo | 28 | 78 | 1412 | 18 | 2.035 | PASS |
| illustration.webp | 1120 | illustration | 34 | 86 | 8703 | 47 | 2.055 | PASS |
| illustration.webp | 1120 | photo | 29 | 73 | 7278 | 26 | 2.209 | PASS |

## Interpretation and visual review

- Icon, corner logo and curves: silhouettes and dominant colors retained; polygon
  Logo uses fewer coordinates. Anti-aliased edges still require tuning; no assertion
  of subpixel-equivalent reconstruction.
- Flat illustration: principal regions/eyes remain visible. JPEG/WebP color variation
  can increase paths and palette fragments. Fallback uses 1px color-matched strokes to reduce seams but can thicken boundaries;
  do not treat fallback output as equal-quality VTracer output.
- Thin line art: relatively larger error and fragmented regions indicate detail loss;
  Photo speckle filtering can remove narrow features. This is a Stage 2 quality priority.
- Gradient/noisy JPEG: pronounced quantization/posterization, especially Logo; output
  can be much larger than the compressed raster. Photo reduces error but is not photo realism.
- Transparent rectangular ring: tested VTracer output retained fully transparent
  background and hole (MAE zero). This fixture does not establish arbitrary partial-alpha support.
- No Vector Magic output, Inkscape session, peak-memory instrumentation, or physical
  Android test was available. No comparison or compatibility claim is inferred.

## Reproduce and inspect evidence

Run README's frozen install, WASM build and check commands, then `npm run test:e2e`.
Raw current observations: benchmark-results/baseline.json (ignored; CI artifact).
A/B screenshots and each exported SVG: test-results/app-real-WASM-traces-fixtu-42fbb-le-SVG-and-records-baseline/.
Mobile screenshot: test-results/app-fallback-failed-WASM-i-fd5c2-set-mobile-and-invalid-file/mobile.png.
These are actual local artifact locations, not deployment URLs; GitHub/GitLab jobs
retain them as artifacts when their pipelines run. Raw generated scores and screenshots
are not committed. The table above transcribes measured observations from the recorded run;
reruns naturally produce different timing values.
