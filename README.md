# NEXORA Vector Engine

**Image → clean, editable SVG.** A 28-day, zero-cost-first project aiming for Vector Magic-like quality on logos, flat-color illustrations, cartoons and line art. This repository is the development home; it is **not affiliated with Vector Magic**.

> **Current status — Stage 0 (foundation only).** No raster-to-vector engine, WASM build, editor, or converter is implemented yet. Stage 1 will be developed separately by the owner's coding agent.

## Project decisions

- Primary upstream candidate: [VTracer](https://github.com/visioncortex/vtracer) (Rust).
- Fallback/comparison: [ImageTracerJS](https://github.com/jankovicsandras/imagetracerjs).
- Optional postprocessing: [SVGO](https://github.com/svg/svgo), only when proven safe.
- Target architecture: browser-first tracing through WebAssembly/Web Workers; no paid GPU or persistent tracing API.
- Source of truth: **GitHub `main`**. Target hosting: **GitLab Pages Free** after a separate GitLab project exists.
- No Netlify, Vercel, Cloudflare or Supabase required.
- Optimize **visual fidelity before speed or UI effects**; quantify claims against real fixtures.

## Where to start

1. Read [AGENTS.md](AGENTS.md) and [Stage 1 handoff](docs/STAGE_01_HANDOFF.md).
2. Review [project charter](docs/00_PROJECT_CHARTER.md), [architecture](docs/02_ARCHITECTURE.md), [quality standards](docs/03_QUALITY_AND_TEST_PLAN.md), and [upstream research](docs/01_UPSTREAM_RESEARCH.md).
3. For the GitLab Pages placeholder, follow [deployment instructions](docs/DEPLOY_GITLAB_PAGES.md). GitLab deployment **has not been executed**.
4. Run `node scripts/validate-stage0.mjs` to validate the documentation and temporary landing site.

## Stage 0 preview

`landing/` contains an honest, static project-status page, **not a fake working converter**. GitLab Pages CI is prepared to publish this placeholder. In Stage 1 the coding agent should replace it with a functional browser implementation and update the Pages build job accordingly.

## Roadmap

- **Week 1 (Stage 1):** real upload → trace → SVG preview → download; basic tests; browser verification.
- **Week 2:** edge-aware segmentation, anti-aliasing handling, and quality experiments.
- **Week 3:** Bézier optimization, corner preservation, editable paths and layering.
- **Week 4:** controlled benchmarks, Android performance, bug fixes and public release candidate.

See [full roadmap](docs/04_ROADMAP.md).

## Licensing

This new repository currently has **no project-wide license selected**. The owner must choose one before public code reuse is permitted. Imported third-party source and distributed dependencies must retain their respective upstream licensing and attribution; review this before shipping. Branding must not suggest ownership of Vector Magic.

**Maintainer:** repository owner `akidwush`.
