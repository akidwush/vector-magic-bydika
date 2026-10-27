#!/usr/bin/env bash
# Evaluation only. Each run owns its artifacts and preserves every failed status.
set -uo pipefail
cd "$(dirname "$0")/.."
root="${NEXORA_ART_STUDY:-$PWD/benchmark-results/stage17a/run-$(git rev-parse --short HEAD)-$(date -u +%Y%m%dT%H%M%S)-$$}"
mkdir -p "$(dirname "$root")"; mkdir "$root" || exit 1
root=$(cd "$root" && pwd)
status=0
record(){ local name=$1; shift; local code=0; "$@" > "$root/$name.log" 2>&1 || code=$?; printf '%s\t%s\n' "$name" "$code" >> "$root/exit-status.tsv"; if [[ $code != 0 ]]; then status=1; fi; }
record legal env NEXORA_ART_LEGAL="$root/legal.json" node scripts/real-artwork-verify.mjs
record wasm bash scripts/build-wasm.sh
record rust cargo test --manifest-path engine/Cargo.toml --locked
record source cargo test --manifest-path engine/Cargo.toml --locked --features source_geometry
record large cargo test --manifest-path engine/Cargo.toml --locked --features large_apex
record hotpath cargo test --manifest-path engine/Cargo.toml --locked --features large_apex,inverse_hotpath
record upstream cargo test --manifest-path engine/Cargo.toml --locked -p vtracer --lib
record metrics node --test scripts/tests/real-artwork.test.mjs
record contour-calibration node scripts/real-artwork-browser-calibration.mjs
record unit npm test
record lint npm run lint
record typecheck npm run typecheck
record build npm run build
record browser env NEXORA_STAGE15_ROOT="$root/regression" NEXORA_BROWSER_EVIDENCE_ROOT="$root/browser" bash scripts/isolated-browser-evidence.sh npm run test:e2e -- --output="$root/e2e"
record offline-quality env NEXORA_ART_VERIFY="$root" bash scripts/real-artwork-offline-quality.sh
record modules env NEXORA_ART_BUILDS="$root/modules" bash scripts/real-artwork-builds.sh
record artwork env NEXORA_ART_ROOT="$root/evaluation" NEXORA_ART_BUILDS="$root/modules" node scripts/real-artwork-benchmark.mjs
record analysis env NEXORA_ART_ROOT="$root/evaluation" node scripts/real-artwork-analyze.mjs
record report env NEXORA_ART_ROOT="$root/evaluation" node scripts/real-artwork-report.mjs
record gallery env NEXORA_ART_ROOT="$root/evaluation" node scripts/real-artwork-gallery.mjs
# Old full source/alpha/topology/geometry/CPU gates remain unchanged and blocking.
record historical env NEXORA_RESEARCH_STAGE=stage17a NEXORA_INVERSE_HOTPATH=1 NEXORA_PROOF_DIR="$root/historical" bash scripts/source-target-research.sh
record protected env NEXORA_PROOF_DIR="$root/protected" bash scripts/inverse-hotpath-proof.sh
# Both historical runners restore the normal application artifacts via traps.
record final-wasm bash scripts/build-wasm.sh
record final-build npm run build
exit "$status"
