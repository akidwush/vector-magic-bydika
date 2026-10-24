# Upstream reuse research — Stage 0

Research date: **2026-10-24**. These are integration candidates, **not installed dependencies**. Stage 1 agent must revalidate licenses, tags, web capabilities and pin exact versions before implementation.

| Repository | Purpose | License observed in source | Status |
|---|---|---|---|
| https://github.com/visioncortex/vtracer | Main Rust tracing algorithm and existing app/WASM research | MIT (license file in repo) | **Preferred; unintegrated** |
| https://github.com/jankovicsandras/imagetracerjs | Browser JS baseline and fallback | Unlicense (license file) | **Fallback; unintegrated** |
| https://github.com/svg/svgo | Optional SVG optimization | MIT (license file) | **Candidate; unintegrated** |

## VTracer research directions
- Read upstream `README.md` and its `crates/`, `nodejs/`, `webapp/` (when present) before deciding how to integrate.
- Confirm which upstream API exposes the desired features: color clustering, watershed, bezier/spline mode, cutout mode and palette limits.
- Distinguish desktop app features from those actually available in the library and browser.
- Prove loaded `.wasm` executes in a real browser; do not assume a Node.js npm package can run in-browser unchanged.
- Benchmark across representative inputs **against the upstream baseline** before custom post-processing.

## ImageTracerJS fallback
- Fastest no-backend browser compatibility fallback if VTracer browser build fails.
- Treat quality and performance as separate, measured baselines.
- Preserve consistent engine adapter output type, errors, cancel semantics and metadata.

## SVGO constraints
- Do not optimize away essential geometry, stable path structure, intended fills or transparent regions.
- Verify whether an SVGO version is safe for browser use; if Node-only, use CI preprocessing where relevant, not a server runtime.
- Measure before/after quality and export validity.

## Intellectual property boundary
- Do not copy proprietary Vector Magic algorithms, private code, website design, fonts, screenshots or assets without permission.
- Do not claim brand affiliation. Refer to Vector Magic only as a benchmark/inspiration.

## Citation links
- https://github.com/visioncortex/vtracer/blob/master/LICENSE
- https://github.com/jankovicsandras/imagetracerjs/blob/master/LICENSE
- https://github.com/svg/svgo/blob/main/LICENSE
