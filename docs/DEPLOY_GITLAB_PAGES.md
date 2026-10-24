# GitLab Pages (Free) deployment — Stage 0 and Stage 1

This repository currently lives on GitHub. A GitLab Pages site **does not exist yet**. GitLab Pages is a static host; actual browser processing must run locally.

## Stage 0 placeholder
1. Create a GitLab Free account and a blank **GitLab project** (private or public as desired).
2. Push/import the **GitHub Stage 0 contents** to that GitLab project. Initial import is not a promise of ongoing sync.
3. GitLab CI reads `.gitlab-ci.yml`, runs `node scripts/validate-stage0.mjs`, copies `landing/` to `public/`, and publishes via `pages: true`.
4. Check **Build > Pipelines** and **Deploy > Pages** for the actual project URL. Do not assume a URL format or claim it is deployed before checking.
5. The published HTML is explicitly a placeholder, **not** a converter.

GitLab docs: https://docs.gitlab.com/ci/yaml/#pages

## Keep GitHub canonical
- For now, owner manually pushes/imports GitHub changes into GitLab (or configures a proper, authenticated one-way sync later).
- No automatic GitHub→GitLab mirroring has been configured by Stage 0.
- If configuring a future GitHub Action mirror, store a narrowly scoped GitLab token in GitHub Actions secrets, never source files; use normal fast-forward pushes and fail safely on divergence.

## Stage 1 migration
- Agent replaces the temporary CI copy operation with build commands appropriate for Vite:
  `npm ci`, validation/test, and `npm run build`.
- Publish the resulting `dist/` folder using GitLab's `pages.publish` or copy it into `public/` then use `pages: true`.
- Configure the bundler base path for the **actual GitLab Pages URL** (project path vs unique domain/custom domain).
- Confirm real URLs for bundled `.wasm` assets, proper MIME, relative asset routing and Android/browser runtime execution.
- Recheck CI quota and current Free terms before running frequent builds.

## Budget guardrail
No billing data, paid compute, deployment secrets in committed files, or background server. GitLab account and deployment require separate owner action.
