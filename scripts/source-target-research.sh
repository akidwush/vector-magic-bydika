#!/usr/bin/env bash
# Offline three-build experiment. A rejected geometry candidate exits nonzero.
set -euo pipefail
cd "$(dirname "$0")/.."
repo_dir="$PWD"
proof_dir="$repo_dir/benchmark-results/stage16b"
mkdir -p "$proof_dir"
backup_dir=$(mktemp -d /tmp/nexora-target-wasm-XXXXXX)
mkdir -p "$backup_dir/wasm"
cp -a src/engine/wasm/. "$backup_dir/wasm/"
if [[ -d dist ]]; then cp -a dist "$backup_dir/dist"; fi
work_dir=""
cleanup() {
  local research_status=$?
  trap - EXIT
  if ! cp -a "$backup_dir/wasm/." "$repo_dir/src/engine/wasm/"; then research_status=1; fi
  if [[ -d "$backup_dir/dist" ]]; then
    if [[ -d "$repo_dir/dist" ]]; then mv "$repo_dir/dist" "$backup_dir/candidate-dist" || research_status=1; fi
    mv "$backup_dir/dist" "$repo_dir/dist" || research_status=1
  elif [[ -d "$repo_dir/dist" ]]; then
    mv "$repo_dir/dist" "$backup_dir/candidate-dist" || research_status=1
  fi
  if [[ -n "$work_dir" ]]; then git worktree remove "$work_dir" || research_status=1; fi
  rm -rf "$backup_dir"
  exit "$research_status"
}
trap cleanup EXIT
for entry in '6084faffbd18313c80b7d4bc8bec349dd88b63c8 stage15-wasm' 'db06a032f7180f349b275ef3801854c048bb674d baseline-wasm'; do
  read -r baseline_commit output_name <<< "$entry"
  if ! git cat-file -e "$baseline_commit^{commit}" 2>/dev/null; then git fetch --depth=1 origin "$baseline_commit"; fi
  work_dir=$(mktemp -d /tmp/nexora-target-baseline-XXXXXX)
  git worktree add --detach "$work_dir" "$baseline_commit"
  CARGO_TARGET_DIR="$repo_dir/engine/target" cargo build --manifest-path "$work_dir/engine/Cargo.toml" --locked --release --target wasm32-unknown-unknown -j2
  wasm-bindgen engine/target/wasm32-unknown-unknown/release/nexora_wasm.wasm --target web --out-dir "$proof_dir/$output_name"
  git worktree remove "$work_dir"
  work_dir=""
done
cargo build --manifest-path engine/Cargo.toml --locked --release --target wasm32-unknown-unknown --features source_geometry -j2
wasm-bindgen engine/target/wasm32-unknown-unknown/release/nexora_wasm.wasm --target web --out-dir src/engine/wasm
npm run build
NEXORA_TEST_PORT="${NEXORA_TEST_PORT:-4187}" npm run test:e2e -- tests/e2e/source-refinement.spec.ts tests/e2e/recovery.spec.ts --output=benchmark-results/stage16b/feature-e2e
node scripts/source-refinement-evidence.mjs
node scripts/source-refinement-editability.mjs
node scripts/source-refinement-quality-gate.mjs
node scripts/subpixel-proof.mjs
node scripts/source-target-benchmark.mjs
node scripts/source-geometry-quality-gate.mjs
