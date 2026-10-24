# GitLab Pages deployment — prepared, not deployed

GitHub main is the canonical source. GitLab is only a static deployment destination.
No GitLab project or authenticated account was available during implementation.

1. Create/import a GitLab project from the GitHub repository using your account.
   Keep a single upstream history; do not develop a separate implementation there.
2. Enable CI and ensure free shared runner quota is available for Rust compilation
   and Chromium tests. Configure one-way synchronization outside browser code if desired;
   credentials belong only in protected provider settings, never source or chat.
3. Run the supplied .gitlab-ci.yml on the default branch. Its validation job installs
   Node 24 and pinned Rust/WASM tools, runs frozen installs, checks, build and real browser tests.
   Pages publishes dist/ only after validation succeeds. Pipeline artifacts include evidence.
4. Verify the actual Pages URL supplied by GitLab. Vite uses relative base './'; test
   coverage serves the build under /nexora/. Check JS, CSS, worker imports and .wasm
   return 200, with application/wasm for WASM, on the actual host.
5. Perform upload → trace → comparison → download on the live URL. Check there are
   no console/network errors or outgoing image requests before reporting deployment verified.

Local `npm run build` emits the real application plus WASM and redistribution notices.
No server, COOP/COEP headers, external tracing API, or paid host is required.
The existing pipeline uses Pages `publish: dist`, not the historical landing/ copy.
GitLab pipeline syntax and live hosting have not been verified against a configured GitLab project.
