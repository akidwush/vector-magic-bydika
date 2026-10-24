# Stage 0 — Product charter

**Repository:** https://github.com/akidwush/vector-magic-bydika

**Product:** NEXORA Vector Engine, a browser-first raster-to-vector tool.

**Goal:** Produce clean, editable SVG files for simple logos, icons, anime/flat illustrations, and line art. Quality approaching commercial tools is a *long-term aspiration*, never an unmeasured claim.

**Development window:** four weeks beginning 24 October 2026. This is a time-box and does not guarantee parity with Vector Magic.

## Scope
- Inputs: PNG, JPEG, WebP, including transparency when supported by format and implementation.
- Outputs: semantically valid editable SVG, preserving viewBox, reasonable geometry and colors.
- Users: mobile Android and desktop browser.
- Processing: local client compute preferred; no required paid API.
- UX: upload -> settings -> trace -> original/vector preview -> download.
- Quality: minimize nodes while preserving contour geometry, corners, region boundaries and color fidelity.

## Explicit non-goals in Stage 0
- No functioning trace engine.
- No production WASM compilation.
- No AI image generation, account system, billing, database, hosted worker or paid API.
- No claims of photo tracing equivalence or full commercial editor parity.
- No production deployment until GitLab project, CI and a live URL are confirmed.

## Decisions and guardrails
- GitHub `main` is canonical; branch-based work with checks before integration.
- GitLab Pages Free is target static host. Stage 0 can only prepare CI; it cannot create a GitLab project.
- Separate license decision is required for original project code. Upstream attribution is mandatory.
- Prioritize fidelity over UI polish; retain usable controls and responsive layout.
