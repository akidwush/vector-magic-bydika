#!/usr/bin/env bash
# Fresh namespaces, no retry, original failures retained; normal artifacts restored.
set -uo pipefail
cd "$(dirname "$0")/.."
root=${NEXORA_WATERSHED_STUDY:-$PWD/benchmark-results/stage17c/run-$(git rev-parse --short HEAD)-$(date -u +%Y%m%dT%H%M%S)-$$}
mkdir -p "$(dirname "$root")";mkdir "$root"||exit 1;root=$(cd "$root"&&pwd);status=0
record(){ local name=$1;shift;local code=0;"$@" > "$root/$name.log" 2>&1||code=$?;printf '%s\t%s\n' "$name" "$code" >> "$root/exit-status.tsv";if [[ $code != 0 ]];then status=1;fi;}
backup=$(mktemp -d /tmp/nexora-region-artifacts-XXXXXX);cp -a src/engine/wasm "$backup/wasm";if [[ -d dist ]];then cp -a dist "$backup/dist";fi
cleanup(){ local code=$?;trap - EXIT;cp -a "$backup/wasm/." src/engine/wasm/||code=1;if [[ -d "$backup/dist" ]];then rm -rf dist;mv "$backup/dist" dist||code=1;fi;rm -rf "$backup";exit "$code";};trap cleanup EXIT
record wasm bash scripts/build-wasm.sh
record rust cargo test --manifest-path engine/Cargo.toml --locked
record source cargo test --manifest-path engine/Cargo.toml --locked --features source_geometry
record large cargo test --manifest-path engine/Cargo.toml --locked --features large_apex
record hotpath cargo test --manifest-path engine/Cargo.toml --locked --features large_apex,inverse_hotpath
record region cargo test --manifest-path engine/Cargo.toml --locked --features watershed_region_research
record combined cargo test --manifest-path engine/Cargo.toml --locked --features large_apex,inverse_hotpath,thin_feature_research,watershed_region_research
record vendor cargo test --manifest-path vendor/vtracer/Cargo.toml --locked --features watershed_region_research,thin_feature_research --lib
record unit npm test
record lint npm run lint
record typecheck npm run typecheck
record build npm run build
record browser env NEXORA_STAGE15_ROOT="$root/regression" NEXORA_BROWSER_EVIDENCE_ROOT="$root/browser" bash scripts/isolated-browser-evidence.sh npm run test:e2e -- --output="$root/e2e"
record offline env NEXORA_ART_VERIFY="$root" bash scripts/real-artwork-offline-quality.sh
record corpus env NEXORA_WATERSHED_CORPUS="$root/corpus" node scripts/watershed-region-corpus.mjs
record modules env NEXORA_WATERSHED_BUILDS="$root/modules" bash scripts/watershed-region-builds.sh
record artwork env NEXORA_ART_ROOT="$root/evaluation" NEXORA_ART_FIXTURES="$root/corpus" NEXORA_ART_BUILDS="$root/modules" NEXORA_ART_CONFIGS_FILE="$root/modules/configs.json" NEXORA_ART_CONFIGS=A-auto,observe,combined,thin-negative node scripts/real-artwork-benchmark.mjs
record measurements env NEXORA_ART_ROOT="$root/evaluation" NEXORA_ART_FIXTURES="$root/corpus" node scripts/watershed-region-measure.mjs
record quality env NEXORA_ART_ROOT="$root/evaluation" node scripts/watershed-region-quality-gate.mjs
record worker env NEXORA_THIN_WORKER_PROOF="$root/worker" NEXORA_THIN_EVALUATION="$root/evaluation" NEXORA_ART_BUILDS="$root/modules" NEXORA_ART_FIXTURES="$root/corpus" node scripts/watershed-region-worker-proof.mjs
record ablation env NEXORA_ART_ROOT="$root/ablation" NEXORA_ART_FIXTURES="$root/corpus" NEXORA_ART_BUILDS="$root/modules" NEXORA_ART_CONFIGS_FILE="$root/modules/configs.json" NEXORA_ART_CONFIGS=A-auto,mosaic,watershed,combined NEXORA_ART_IMAGES=original-garden-512-low-contrast,original-garden-512,original-small-symbols-128,orbital-badge-128,orbital-badge-512,paper-botanical-128,paper-botanical-512 node scripts/real-artwork-benchmark.mjs
record ablation-measure env NEXORA_ART_ROOT="$root/ablation" NEXORA_ART_FIXTURES="$root/corpus" node scripts/watershed-region-measure.mjs
record diagnosis env NEXORA_THIN_DIAG_ROOT="$root/diagnosis" NEXORA_THIN_MODULE="$root/modules/research" NEXORA_THIN_BASELINE_RUN="$root/evaluation" NEXORA_THIN_MODE=0 NEXORA_THIN_IMAGES=original-garden-512-low-contrast,original-small-symbols-128,paper-botanical-128 node scripts/watershed-region-diagnose.mjs
record historical env NEXORA_RESEARCH_STAGE=stage17c NEXORA_INVERSE_HOTPATH=1 NEXORA_PROOF_DIR="$root/historical" bash scripts/source-target-research.sh
record protected env NEXORA_PROOF_DIR="$root/protected" bash scripts/inverse-hotpath-proof.sh
record enabled env NEXORA_WATERSHED_ENABLED="$root/enabled" NEXORA_WATERSHED_F="$root/protected/F" bash scripts/watershed-region-enabled.sh
mkdir "$root/enabled-budget";ln -s "$root/enabled" "$root/enabled-budget/runtime-identity"
record budget env NEXORA_PROOF_DIR="$root/enabled-budget" node scripts/inverse-hotpath-budget-gate.mjs
record experimental-browser env NEXORA_THIN_BROWSER="$root/experimental-browser" NEXORA_THIN_BROWSER_MODULE="$root/enabled/candidate" bash scripts/thin-feature-browser.sh
record final-wasm bash scripts/build-wasm.sh
record final-build npm run build
exit "$status"
