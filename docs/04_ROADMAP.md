# 28-day roadmap

**24–30 Oct 2026 — Week 1 / Stage 1: working browser tracer**
- Select upstream pinned VTracer browser build; fallback to ImageTracerJS when required.
- PNG/JPEG/WebP upload, trace presets, worker pipeline, SVG preview + download.
- Six fixtures, actual browser smoke, quality baseline, CI and GitLab Pages migration.

**31 Oct–6 Nov — Week 2: clean-vector quality**
- Investigate anti-alias-aware segmentation, edge-sensitive clustering and contour refinement.
- Analyze region gaps, small artifacts and palette quantization; rerun benchmark.
- Do not rewrite the entire upstream engine. Add isolated measurable enhancements.

**7–13 Nov — Week 3: shape precision**
- Fit and simplify curves, preserve corners, reduce redundant nodes.
- Prevent seams and unnecessary path overlaps; improve editable outputs.
- Add limited manual correction UX only if core quality is stable.

**14–20 Nov — Week 4: validation and release candidate**
- 40-image comparison suite, browser/device coverage, memory and CPU safety.
- Fix highest-impact regressions, test Android, finalize docs and release candidate.
- Report where quality is not yet comparable to Vector Magic.

Dates are planning targets, **not delivery guarantees**. Do not certify week outcomes without working code and evidence.
