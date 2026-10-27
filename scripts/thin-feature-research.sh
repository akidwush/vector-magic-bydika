#!/usr/bin/env bash
# One fresh namespace. Every command retains its original exit status; no retries.
set -uo pipefail
cd "$(dirname "$0")/.."
root="${NEXORA_THIN_STUDY:-$PWD/benchmark-results/stage17b/run-$(git rev-parse --short HEAD)-$(date -u +%Y%m%dT%H%M%S)-$$}"
mkdir -p "$(dirname "$root")"; mkdir "$root" || exit 1
root=$(cd "$root" && pwd)
status=0
record(){ local name=$1; shift; local code=0; "$@" > "$root/$name.log" 2>&1 || code=$?; printf '%s\t%s\n' "$name" "$code" >> "$root/exit-status.tsv"; if [[ $code != 0 ]]; then status=1; fi; }
record regeneration env NEXORA_THIN_REGEN_ROOT="$root/regeneration" node scripts/thin-feature-regenerate.mjs
record legal env NEXORA_ART_LEGAL="$root/legal.json" node scripts/real-artwork-verify.mjs
record wasm bash scripts/build-wasm.sh
record rust cargo test --manifest-path engine/Cargo.toml --locked
record source cargo test --manifest-path engine/Cargo.toml --locked --features source_geometry
record large cargo test --manifest-path engine/Cargo.toml --locked --features large_apex
record hotpath cargo test --manifest-path engine/Cargo.toml --locked --features large_apex,inverse_hotpath
record thin cargo test --manifest-path engine/Cargo.toml --locked --features thin_feature_research
record combined cargo test --manifest-path engine/Cargo.toml --locked --features large_apex,inverse_hotpath,thin_feature_research
record upstream cargo test --manifest-path vendor/vtracer/Cargo.toml --locked --features thin_feature_research --lib
record unit npm test
record lint npm run lint
record typecheck npm run typecheck
record build npm run build
record browser env NEXORA_STAGE15_ROOT="$root/regression" NEXORA_BROWSER_EVIDENCE_ROOT="$root/browser" bash scripts/isolated-browser-evidence.sh npm run test:e2e -- --output="$root/e2e"
record offline-quality env NEXORA_ART_VERIFY="$root" bash scripts/real-artwork-offline-quality.sh
record corpus env NEXORA_THIN_CORPUS="$root/corpus" node scripts/thin-feature-corpus.mjs
record modules env NEXORA_THIN_BUILDS="$root/modules" bash scripts/thin-feature-builds.sh
record artwork env NEXORA_ART_ROOT="$root/evaluation" NEXORA_ART_FIXTURES="$root/corpus" NEXORA_ART_BUILDS="$root/modules" NEXORA_ART_CONFIGS_FILE="$root/modules/configs.json" NEXORA_ART_CONFIGS=A-auto,thin-observe,thin-structural,thin-negative node scripts/real-artwork-benchmark.mjs
record analysis env NEXORA_ART_ROOT="$root/evaluation" NEXORA_ART_FIXTURES="$root/corpus" NEXORA_ART_ROUNDTRIP_CONFIGS=A-auto,thin-structural,thin-negative node scripts/real-artwork-analyze.mjs
record ablation env NEXORA_ART_ROOT="$root/ablation" NEXORA_ART_FIXTURES="$root/corpus" NEXORA_ART_BUILDS="$root/modules" NEXORA_ART_CONFIGS_FILE="$root/modules/configs.json" NEXORA_ART_CONFIGS=A-auto,thin-precision,thin-thread NEXORA_ART_IMAGES=original-signage-128,original-signage-512,original-anime-128,original-anime-512,circuit-ribbon-128,circuit-ribbon-512 node scripts/real-artwork-benchmark.mjs
record ablation-analysis env NEXORA_ART_ROOT="$root/ablation" NEXORA_ART_FIXTURES="$root/corpus" node scripts/real-artwork-analyze.mjs
record diagnosis env NEXORA_THIN_DIAG_ROOT="$root/diagnosis" NEXORA_THIN_MODULE="$root/modules/research" NEXORA_THIN_BASELINE_RUN="$root/evaluation" node scripts/thin-feature-diagnose.mjs
record lifecycle env NEXORA_THIN_DIAG_ROOT="$root/diagnosis" node scripts/thin-feature-lifecycle.mjs
record full-diagnosis env NEXORA_THIN_MODE=3 NEXORA_THIN_DIAG_ROOT="$root/full-diagnosis" NEXORA_THIN_MODULE="$root/modules/research" NEXORA_THIN_BASELINE_RUN="$root/evaluation" node scripts/thin-feature-diagnose.mjs
record full-lifecycle env NEXORA_THIN_DIAG_ROOT="$root/full-diagnosis" node scripts/thin-feature-lifecycle.mjs
record candidate-diagnosis env NEXORA_THIN_MODE=4 NEXORA_THIN_DIAG_ROOT="$root/candidate-diagnosis" NEXORA_THIN_MODULE="$root/modules/research" NEXORA_THIN_BASELINE_RUN="$root/evaluation" node scripts/thin-feature-diagnose.mjs
record candidate-lifecycle env NEXORA_THIN_DIAG_ROOT="$root/candidate-diagnosis" node scripts/thin-feature-lifecycle.mjs
record full-local env NEXORA_THIN_EVALUATION="$root/evaluation" NEXORA_ART_FIXTURES="$root/corpus" NEXORA_THIN_LOCAL_DIAG_ROOT="$root/full-diagnosis" node scripts/thin-feature-local-proof.mjs
record candidate-local env NEXORA_THIN_LOCAL_STRICT=1 NEXORA_THIN_CANDIDATE_ID=thin-negative NEXORA_THIN_EVALUATION="$root/evaluation" NEXORA_ART_FIXTURES="$root/corpus" NEXORA_THIN_LOCAL_DIAG_ROOT="$root/candidate-diagnosis" node scripts/thin-feature-local-proof.mjs
record candidate-worker env NEXORA_THIN_CANDIDATE_ID=thin-negative NEXORA_THIN_MODE=4 NEXORA_THIN_WORKER_PROOF="$root/candidate-worker" NEXORA_THIN_EVALUATION="$root/evaluation" NEXORA_ART_BUILDS="$root/modules" NEXORA_ART_FIXTURES="$root/corpus" node scripts/thin-feature-worker-proof.mjs
# Historical gates stay unchanged and blocking, including known timing failures.
record historical env NEXORA_RESEARCH_STAGE=stage17b NEXORA_INVERSE_HOTPATH=1 NEXORA_PROOF_DIR="$root/historical" bash scripts/source-target-research.sh
record protected env NEXORA_PROOF_DIR="$root/protected" bash scripts/inverse-hotpath-proof.sh
record enabled env NEXORA_THIN_MODE=4 NEXORA_THIN_ENABLED="$root/enabled" NEXORA_THIN_F_BASELINE="$root/protected/F" bash scripts/thin-feature-enabled.sh
record experimental-browser env NEXORA_THIN_BROWSER="$root/experimental-browser" NEXORA_THIN_BROWSER_MODULE="$root/enabled/candidate" bash scripts/thin-feature-browser.sh
record visuals env NEXORA_THIN_CANDIDATE_ID=thin-negative NEXORA_THIN_EVALUATION="$root/evaluation" NEXORA_ART_FIXTURES="$root/corpus" node scripts/thin-feature-visuals.mjs
record review env NEXORA_THIN_STRICT_SOURCE=1 NEXORA_THIN_CANDIDATE_ID=thin-negative NEXORA_THIN_EXPECT_IMAGES=39 NEXORA_THIN_EXPECT_CONFIGS=4 NEXORA_THIN_EVALUATION="$root/evaluation" node scripts/thin-feature-review.mjs
record final-wasm bash scripts/build-wasm.sh
record final-build npm run build
exit "$status"
