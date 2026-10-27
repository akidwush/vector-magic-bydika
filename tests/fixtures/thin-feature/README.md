# Stage 1.7B source-only fixtures

The three original design families and all derived rasters are dedicated to
**CC0-1.0**. They contain outlined geometry, not a font or competitor's artwork.
This dedication applies to the artwork only, not the application's unlicensed
original source code.

`circuit-ribbon` is development. `stencil-kite` and `ribbon-garden` are independent
validation families; neither shares the development SVG template. Their outcome
must not be inspected to choose protection thresholds. Every size is independently
rasterized from its legal SVG reference at 4× then Lanczos3 downsampled. Reference
paths and annotations never enter the engine. Sources, hashes and splits are in
`manifest.json`; `scripts/thin-feature-fixtures.mjs` regenerates the corpus.

The Stage 1.7A manifest remains unchanged. Its small-symbols and garden families
remain validation-only even though the Stage 1.7B task names them as primary
repair targets. They can diagnose a failure class and test frozen rules, but must
not become hidden threshold-tuning cases.
