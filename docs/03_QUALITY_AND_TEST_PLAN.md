# Quality bar and test plan

A subjective claim such as "looks like Vector Magic" is **not** acceptance evidence. Maintain a fixed baseline corpus and measurements.

## Initial fixtures (Stage 1: at least 6)
1. Black/white clean icon.
2. Logo with crisp corners.
3. Flat cartoon with 4-12 colors.
4. Transparent shape with internal holes.
5. Line art with narrow strokes.
6. Graded/noisy JPEG illustration.

Week 4: expand to 40 images (10 logos, 10 flat/anime, 10 complex illustrations, 10 photos/gradients) using self-produced or clearly licensed fixtures.

## Measured metrics
- Raster reproduction: silhouette agreement, boundary fidelity, color fidelity and transparency.
- Structure: path count, anchor/node count when parsable, file size and editable path semantics.
- Performance: trace wall time, browser, input dimensions, memory/peak estimates if measurable.
- Regression: render output SVG to raster at the same dimensions and compare systematically.
- Reference comparisons: when legitimately available, Vector Magic outputs are a **comparison**, not a required dependency.

Document device, browser version, fixture ID, preset, engine version and capture methodology. Never invent benchmark scores.

## Stage 1 acceptance
- Correct input validation for PNG/JPEG/WebP and meaningful failure for malformed files.
- Actual browser trace (not mocked), valid editable SVG output, preview + download.
- Rendering non-empty shapes, retaining aspect ratio and supported transparency.
- A/B comparison with originals for six baseline fixtures.
- Passing automated tests, lint, typecheck, production build and real-browser smoke test where possible.
- No user-image upload or required paid API.

## Stage 0 checks
- `node scripts/validate-stage0.mjs` confirms repo bootstrap/documentation/landing files exist and placeholder status is honest.
- GitHub CI validates the baseline from a clean checkout.
- GitLab CI config is prepared, **not tested against an actual GitLab project**.
