# Stage 1.7A artwork corpus

31 evaluation images, 18 asset families, 17 independent design groups; 11 strict
holdout images. The initial pre-trace manifest is preserved as `manifest.v1.json`.
Review found two portrait siblings sharing a template across the initial split;
schema 2 moves the side portrait into the same development group. No raster,
reference or engine threshold changed. Reports retain recorded and effective splits.
Holdout is not used to tune engine
or diagnostic thresholds. This is a small flat-art corpus, not a representative
sample of all professional anime, photographs or vector-design workflows.

`manifest.json` contains per-image provenance, attribution, licenses, source and
raster hashes, independent versus resized resolution, format/opacity changes,
ROI annotations and reference availability. `scripts/real-artwork-fixtures.mjs`
regenerates original SVGs and all derived rasters offline. It never reads SVG
conversion results. Each SVG-backed resolution is independently rendered at 4x
then downsampled, not enlarged from a smaller raster. Noise and codecs are declared
raster degradations; the noisy garden's reference is deliberately withheld from
evaluation, not claimed nonexistent. Kenney city is genuinely raster-only here.

## Rights and attribution

- Twemoji graphics, Copyright 2019 Twitter, Inc and other contributors,
  **CC-BY 4.0**. The unmodified SVGs are pinned to Twemoji v14.0.2, commit
  `7a3dad4a4da30497093dab22eafba135f02308e1`.
  Original source URLs are recorded per image. Graphics license and the upstream
  README attribution statement are retained in `licenses/`. Rasterized/compressed
  derivatives and benchmark exports must retain attribution and note their changes.
- Kenney Starter Kit City Builder documentation screenshot, pinned commit
  `4535092b740b378b700efd9df9e27a631815b84a`, **MIT**. Copyright (c) 2025 Kenney.
  MIT notice and upstream README are retained. README additionally identifies its
  sprites/models as CC0. We conservatively retain the repository MIT notice for
  this documentation screenshot rather than asserting a separate CC0 image grant.
  The raster original is retained, and the benchmark derivative is aspect-preserving
  downsampling. No original vector reference is available to the evaluator.
- `original-*` fixture artwork was authored for this benchmark and is dedicated
  to **CC0-1.0**. This includes the outlined glyph artwork: no font file or
  proprietary character artwork is embedded. Dedication applies to artwork,
  not to the repository's otherwise unlicensed original application code.

None of the assets are user uploads, competitor outputs or a claim of affiliation
with Twitter, Kenney, Vector Magic or Vectorizer.AI. Full attribution/rights remain
applicable to exported evidence. Noto assets were not included: the inspected
README's Apache image statement and the linked font-license file were insufficiently
clear for this corpus, so explicit Twemoji graphics licensing was preferred.

## Scope of truth

Known SVG references are used offline only, never passed to the conversion Worker.
Visible-silhouette geometry is sampled using browser SVG geometry APIs, including
path endpoints and transforms. Visibility filtering and raster-mask topology are
approximate, not a certified Hausdorff bound or correspondence of hidden layers.
Original compass outer corners have explicit vector annotation. Other images do
not have certified semantic corner labels or original designer node correspondence.

Pixel reconstruction, detail ROIs, complexity and visual review are reported for
all rows. Raster-only rows never receive invented true-vector boundary or corner
recall measurements. Native-resolution reconstruction and local error crops are
kept separate from geometric error.
