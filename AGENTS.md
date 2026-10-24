# Agent instructions — NEXORA Vector Engine

Read this file and `docs/STAGE_01_HANDOFF.md` before writing code.

## Project constraints
- The owner implements **Stage 1 in a separate coding-agent session**. Do not start Stage 1 while executing Stage 0.
- Use proven open-source tracing engines; **do not write a new raster tracing engine from scratch**.
- The preferred candidate is VTracer. Verify genuine browser WASM execution; the Node.js npm wrapper is not automatic proof of browser support.
- If necessary, ship a working ImageTracerJS fallback and report why VTracer could not run.
- No Netlify, Vercel, Cloudflare, Supabase, paid GPU, persistent backend or secret-dependent runtime.
- GitHub `main` is the source of truth. GitLab Pages is an optional **deployment destination**, not the upstream source of code.
- Never commit credentials, image uploads, compiled private binaries, or generated benchmark scores.
- No fake data, fabricated screenshots, pretend tests, or claims of Vector Magic equivalence.
- Preserve third-party licenses, documentation and attribution. Do not use Vector Magic's brand as a product name.

## Engineering contract for Stage 1
1. Audit all current files, identify dependencies and confirm target environment.
2. Record exact upstream commit/tag and licenses before integrating any third-party code.
3. Implement a `TraceEngine` interface to isolate VTracer, ImageTracerJS and future processing.
4. Decode PNG, JPG/JPEG and WebP with clear errors and input resource caps.
5. Prefer in-browser WebAssembly/Web Workers. All uploaded images stay on-device by default.
6. Export **real SVG paths**, not a raster embedded as an SVG <image> element.
7. Preview untrusted SVG in a sandboxed or safely sanitized context; avoid unsanitized HTML injection.
8. Avoid cross-domain download redirects; use downloadable object URLs and revoke them correctly.
9. Write real tests, evidence-backed benchmark and CI. Do not claim browsers tested without running them.
10. Update `.gitlab-ci.yml` from temporary `landing/` publishing to Vite `dist/` publishing after the Stage 1 app builds.
11. Record unresolved problems rather than masking errors with fake success.
12. Keep changes focused. Prefer a feature branch and review before merging to `main`; never force-push.

## Definition of done
Use `docs/STAGE_01_HANDOFF.md`. If any criterion fails, report it explicitly. Do not mark Stage 1 completed prematurely.
