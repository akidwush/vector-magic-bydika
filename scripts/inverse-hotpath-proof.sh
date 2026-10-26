#!/usr/bin/env bash
# Actual downloads and independent rasterization, isolated from historical scores.
set -euo pipefail
cd "$(dirname "$0")/.."
proof="${NEXORA_PROOF_DIR:-$PWD/benchmark-results/stage16h/proof-$(git rev-parse --short HEAD)-$(date -u +%Y%m%dT%H%M%S)-$$}"
mkdir -p "$(dirname "$proof")"
mkdir "$proof"
backup=$(mktemp -d /tmp/nexora-inverse-proof-XXXXXX)
cp -a src/engine/wasm "$backup/wasm"
if [[ -d dist ]]; then cp -a dist "$backup/dist"; fi
work=""
cleanup(){
 local code=$?; trap - EXIT
 cp -a "$backup/wasm/." src/engine/wasm/ || code=1
 if [[ -d dist ]]; then mv dist "$backup/candidate-dist" || code=1; fi
 if [[ -d "$backup/dist" ]]; then mv "$backup/dist" dist || code=1; fi
 if [[ -n "$work" ]]; then git worktree remove "$work" || code=1; fi
 rm -rf "$backup"
 exit "$code"
}
trap cleanup EXIT
baseline=c7f47512598cec01ad0adc9516af94e3ff58c963
if ! git cat-file -e "$baseline^{commit}" 2>/dev/null; then git fetch --depth=1 origin "$baseline"; fi
work=$(mktemp -d /tmp/nexora-inverse-baseline-XXXXXX)
git worktree add --detach "$work" "$baseline"
CARGO_TARGET_DIR="$PWD/engine/target" cargo build --manifest-path "$work/engine/Cargo.toml" --locked --release --target wasm32-unknown-unknown --features large_apex -j2
wasm-bindgen engine/target/wasm32-unknown-unknown/release/nexora_wasm.wasm --target web --out-dir "$proof/F"
git worktree remove "$work"; work=""
cargo build --manifest-path engine/Cargo.toml --locked --release --target wasm32-unknown-unknown --features large_apex,inverse_hotpath -j2
wasm-bindgen engine/target/wasm32-unknown-unknown/release/nexora_wasm.wasm --target web --out-dir "$proof/H"
wasm-bindgen engine/target/wasm32-unknown-unknown/release/nexora_wasm.wasm --target web --out-dir src/engine/wasm
npm run build
NEXORA_LARGE_APEX=1 NEXORA_STAGE15_ROOT="$proof/regression" NEXORA_LOW_RES_ROOT="$proof/browser" NEXORA_TEST_PORT="${NEXORA_TEST_PORT:-4187}" NEXORA_BROWSER_EVIDENCE_ROOT="$proof/compatibility" bash scripts/isolated-browser-evidence.sh npm run test:e2e -- --output="$proof/e2e"
NEXORA_CANDIDATE_WASM="$proof/H" NEXORA_COMPARE_STAGE=16g NEXORA_STAGE16B_WASM="$proof/F" NEXORA_PROOF_DIR="$proof/runtime-identity" node scripts/low-resolution-benchmark.mjs
NEXORA_PROOF_DIR="$proof" node scripts/runtime-identity-gate.mjs
NEXORA_PROOF_DIR="$proof" node scripts/inverse-hotpath-budget-gate.mjs
NEXORA_PROOF_DIR="$proof/runtime-identity" node scripts/low-resolution-editability.mjs
