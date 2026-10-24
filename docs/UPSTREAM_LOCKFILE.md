# Upstream provenance and integration lock

## VTracer (active browser engine)

- URL: https://github.com/visioncortex/vtracer
- Exact Git commit: `e71343fbcbf469b8a72a255030408a39939162eb`
- Core package: 1.0.0-alpha.4, from `crates/vtracer` at that commit.
- Upstream declares MIT OR Apache-2.0. This distribution uses the supplied MIT grant;
  its LICENSE is retained in vendor/vtracer/LICENSE and distribution notices.
- Integration: unchanged Rust core source in vendor/vtracer/src; flattened standalone
  Cargo manifest; project-owned thin wasm-bindgen binding in engine/.
- Dependency checksums/versions: engine/Cargo.lock. visioncortex 0.9.3 and
  flo_curves 0.8.0 pinned; transitive flo_curves 0.3.1 belongs to upstream visioncortex.
- Build instructions and preset mapping: STAGE_01_IMPLEMENTATION_NOTES.md.
- Browser verified, without importing Node APIs. Source pin is alpha, not an API-stability claim.

## ImageTracerJS (tested fallback)

- URL: https://github.com/jankovicsandras/imagetracerjs
- Exact published npm release: `imagetracerjs@1.2.6`; registry artifact integrity in package-lock.json.
- License: Unlicense; full notice included in THIRD_PARTY_NOTICES.txt.
- Integration: imported package's imagedataToSVG; no tracing logic copied or rewritten.
- Deterministic sampling and parameters documented in implementation notes.
- Native-browser PNG/WebP tracing, auto fallback and forced selection verified.
  Fallback is a compatibility baseline and does not promise equivalent alpha/fidelity.

## SVGO (evaluated, not installed)

- URL: https://github.com/svg/svgo
- Inspected main package metadata: 4.1.0, MIT; includes `svgo/browser` export.
- Deferred to avoid introducing an unbenchmarked output transform. No dependency
  or source from SVGO is distributed.

## Other dependencies

React/React DOM and scheduler (MIT), plus ImageTracerJS, are bundled browser JS.
Exact npm versions and integrity hashes are in package-lock.json. Rust checksums
are in engine/Cargo.lock. Full redistribution notices for vendored core, registry
Rust packages, and browser JS dependencies are in THIRD_PARTY_NOTICES.txt and copied
to the static build. Development tools are not imported into browser runtime.

Original NEXORA source has no project-wide license selected by the owner.
Fixture artwork alone is explicitly CC0-1.0; this does not license the application.
