# Stage 1.6C visual evidence

These are unedited Chromium screenshots and actual browser SVG downloads from
implementation commit `f67cdb36b61083bc21297e8c46d44ac6f7595ca6`, measured locally
on 2026-10-26. Inputs and references are original legal project fixtures under
`tests/fixtures/curve-optimization/`.

Each screenshot uses the same viewport/ROI for Original Raster | Stage 1.6B
(`564b643`) | Stage 1.6C (`f67cdb3`). The engine is VTracer WASM, Illustration
preset, with experimental source geometry and conservative node reduction.

The SVGs are actual editable exports. No source pixels are embedded in them.
Wave still has pre-existing false bottom corners: improved local recovery does
not imply that the entire contour is correct. Timings printed on the screenshots
are first-run wall time; the report also records all paired cold/warm runs.

See `docs/STAGE_01_6C_LOW_RESOLUTION_GEOMETRY_REPORT.md` for measurements,
limitations, exact provenance and the CI artifact containing all 45 comparisons.
