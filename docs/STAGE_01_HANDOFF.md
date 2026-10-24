# Stage 1 handoff — for owner's separate GPT coding agent

**Repository:** https://github.com/akidwush/vector-magic-bydika
**Starting state:** Stage 0 files + honest static landing page; no actual engine.
**Owner's instruction:** Stage 1 is to be performed by another agent. Do not claim Stage 0 already contains a functional converter.

## Task
Implement the first working version of NEXORA Vector Engine using EXISTING OPEN-SOURCE tracing implementations; do **not** invent raster-to-vector tracing algorithms from scratch.

1. Audit the Stage 0 repository and read `AGENTS.md`, charter, architecture, upstream research, quality plan.
2. Select and pin VTracer Rust/WASM browser integration after examining upstream actual capabilities. Log attempts, compile commands and output assets.
3. If browser VTracer cannot be integrated reliably, implement a functional ImageTracerJS fallback, preserving a stable adapter interface and explaining the blocker.
4. Build responsive Vite + React + TypeScript UI: input image -> presets -> convert -> A/B preview -> download SVG.
5. Work client-side; use workers where feasible, validate files, cap memory, expose authentic progress/status and errors.
6. Export SVG **geometric paths** (never just embed raster) and safe preview. Handle output object URL lifecycle.
7. Add unit/browser tests, 6-image fixture set and baseline measurements; record real device evidence, if available.
8. Replace Stage 0's static `landing/` GitLab Pages job with Vite `dist/` publish. Respect project-specific path bases and emitted WASM MIME/URLs.
9. Keep GitHub `main` canonical; develop with normal commits and review, don't force push. GitLab project creation and mirroring need owner-provided account access. Do not create fake credentials or hosted URLs.
10. Update README status and produce `docs/STAGE_01_REPORT.md` with proof, remaining issues and upstream attribution.

## Non-negotiable constraints
- Rp0 infrastructure target. No Supabase, Netlify, Vercel, Cloudflare, paid GPU, remote tracing API, persistent server or payment system.
- Never rewrite upstream VTracer/ImageTracerJS tracing logic as original code in Stage 1.
- Do not confuse Node.js-only WASM with real browser support.
- No cosmetic-only implementation, dummy download, fake visual diff or fabricated benchmark.
- Keep third-party licensing obligations and exact upstream revisions documented.

## Stage 1 completion checklist
- [ ] Real PNG/JPEG/WebP images trace in an actual browser
- [ ] SVG contains usable path/shape data and correctly previews
- [ ] Download stays on site and file opens in a vector editor
- [ ] Input/memory limits, meaningful errors, mobile layout
- [ ] At least six real fixture results and timings
- [ ] CI validation and build pass
- [ ] GitLab Pages static artifact includes WASM when used
- [ ] README and Stage 1 report are honest, current and complete

If one or more criteria fail, keep them unchecked and explain the failure. Do not declare success.
