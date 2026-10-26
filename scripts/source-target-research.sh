#!/usr/bin/env bash
# Offline three-build experiment. A rejected geometry candidate exits nonzero.
set -euo pipefail
cd "$(dirname "$0")/.."
repo_dir="$PWD"
# One immutable artifact namespace per execution. Historical Stage 1.6B output
# is never used as a writable destination.
proof_dir="${NEXORA_PROOF_DIR:-$repo_dir/benchmark-results/${NEXORA_RESEARCH_STAGE:-stage16g}/$(git rev-parse --short HEAD)-$(date -u +%Y%m%dT%H%M%S)-$$}"
if [[ "$proof_dir" != /* ]]; then proof_dir="$repo_dir/$proof_dir"; fi
mkdir -p "$(dirname "$proof_dir")"
mkdir "$proof_dir"
export NEXORA_PROOF_DIR="$proof_dir"
export NEXORA_STAGE15_ROOT="$proof_dir/regression"
export NEXORA_LOW_RES_ROOT="$proof_dir/browser"
export NEXORA_STAGE16B_WASM="$proof_dir/stage16b-wasm"
node --input-type=module - "$proof_dir" <<'JSMETA'
import {writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
await writeFile(process.argv[2]+'/run.json',JSON.stringify({
 commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
 dirty:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),
 started:new Date().toISOString(),
 comparator:'564b643d53ecc5897f6c3b8a0174ccd807c47dcd',
 largeApexComparator:'0b67da0cce87476adc59acc7396eb8cfd542452a',
 source:'original input resolution only; references are offline metrics'
},null,2));
JSMETA
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
for entry in '6084faffbd18313c80b7d4bc8bec349dd88b63c8 stage15-wasm' 'db06a032f7180f349b275ef3801854c048bb674d baseline-wasm' '564b643d53ecc5897f6c3b8a0174ccd807c47dcd stage16b-wasm' '5f69567c357eb0bb5930925fa7d35d132de2f3a5 stage16c-wasm' 'b1fa0c572c94b8a432735cd981c88570ba890c2a stage16d-wasm' '0b67da0cce87476adc59acc7396eb8cfd542452a stage16e-wasm' 'c7f47512598cec01ad0adc9516af94e3ff58c963 stage16f-wasm'; do
  read -r baseline_commit output_name <<< "$entry"
  if ! git cat-file -e "$baseline_commit^{commit}" 2>/dev/null; then git fetch --depth=1 origin "$baseline_commit"; fi
  work_dir=$(mktemp -d /tmp/nexora-target-baseline-XXXXXX)
  git worktree add --detach "$work_dir" "$baseline_commit"
  baseline_features=()
  if [[ "$output_name" == stage16b-wasm || "$output_name" == stage16c-wasm || "$output_name" == stage16d-wasm || "$output_name" == stage16e-wasm ]]; then baseline_features=(--features source_geometry); fi
  if [[ "$output_name" == stage16f-wasm ]]; then baseline_features=(--features large_apex); fi
  CARGO_TARGET_DIR="$repo_dir/engine/target" cargo build --manifest-path "$work_dir/engine/Cargo.toml" --locked --release --target wasm32-unknown-unknown "${baseline_features[@]}" -j2
  wasm-bindgen engine/target/wasm32-unknown-unknown/release/nexora_wasm.wasm --target web --out-dir "$proof_dir/$output_name"
  git worktree remove "$work_dir"
  work_dir=""
done
cargo build --manifest-path engine/Cargo.toml --locked --release --target wasm32-unknown-unknown --features source_geometry -j2
wasm-bindgen engine/target/wasm32-unknown-unknown/release/nexora_wasm.wasm --target web --out-dir src/engine/wasm
npm run build
NEXORA_TEST_PORT="${NEXORA_TEST_PORT:-4187}" npm run test:e2e -- tests/e2e/source-refinement.spec.ts tests/e2e/recovery.spec.ts tests/e2e/low-resolution.spec.ts tests/e2e/false-corner.spec.ts tests/e2e/sharp-apex.spec.ts --output="$proof_dir/feature-e2e"
node scripts/source-refinement-evidence.mjs
node scripts/source-refinement-editability.mjs
# Retain the old gate files and their thresholds byte-for-byte. Their relative
# evidence paths resolve inside a private namespace, not the historical outputs.
namespace="$backup_dir/gate-workspace"
mkdir -p "$namespace/benchmark-results" "$proof_dir/subpixel"
ln -s "$repo_dir/tests" "$namespace/tests"
ln -s "$proof_dir/regression" "$namespace/benchmark-results/stage15"
ln -s "$proof_dir/subpixel" "$namespace/benchmark-results/stage16"
ln -s "$proof_dir" "$namespace/benchmark-results/stage16b"
(
  cd "$namespace"
  node "$repo_dir/scripts/source-refinement-quality-gate.mjs"
  node "$repo_dir/scripts/subpixel-proof.mjs"
)
node scripts/source-target-benchmark.mjs
(
  cd "$namespace"
  node "$repo_dir/scripts/source-geometry-quality-gate.mjs"
)
node scripts/low-resolution-benchmark.mjs
node scripts/low-resolution-quality-gate.mjs
node scripts/low-resolution-editability.mjs

NEXORA_COMPARE_STAGE=16d NEXORA_STAGE16B_WASM="$proof_dir/stage16c-wasm" NEXORA_PROOF_DIR="$proof_dir/false-corner" node scripts/low-resolution-benchmark.mjs
node scripts/false-corner-quality-gate.mjs
node scripts/false-corner-evidence.mjs

NEXORA_COMPARE_STAGE=16e NEXORA_STAGE16B_WASM="$proof_dir/stage16d-wasm" NEXORA_PROOF_DIR="$proof_dir/sharp-apex" node scripts/low-resolution-benchmark.mjs
node scripts/sharp-apex-quality-gate.mjs

# Separate Cargo contract: preserve ordinary source_geometry results and gates.
cargo test --manifest-path engine/Cargo.toml --locked --features large_apex
cargo build --manifest-path engine/Cargo.toml --locked --release --target wasm32-unknown-unknown --features large_apex -j2
wasm-bindgen engine/target/wasm32-unknown-unknown/release/nexora_wasm.wasm --target web --out-dir "$proof_dir/large-apex-wasm"
wasm-bindgen engine/target/wasm32-unknown-unknown/release/nexora_wasm.wasm --target web --out-dir src/engine/wasm
npm run build
NEXORA_LARGE_APEX=1 NEXORA_STAGE15_ROOT="$proof_dir/large-regression" NEXORA_LOW_RES_ROOT="$proof_dir/large-browser" NEXORA_TEST_PORT="${NEXORA_TEST_PORT:-4187}" npm run test:e2e -- --output="$proof_dir/large-feature-e2e"
NEXORA_COMPARE_STAGE=16f NEXORA_STAGE16B_WASM="$proof_dir/stage16e-wasm" NEXORA_PROOF_DIR="$proof_dir/large-apex" node scripts/low-resolution-benchmark.mjs
node scripts/large-apex-quality-gate.mjs

# Cache prototype is tested separately; the ordinary feature above stays unchanged.
cargo test --manifest-path engine/Cargo.toml --locked --features large_apex,runtime_cache
cargo build --manifest-path engine/Cargo.toml --locked --release --target wasm32-unknown-unknown --features large_apex,runtime_cache -j2
wasm-bindgen engine/target/wasm32-unknown-unknown/release/nexora_wasm.wasm --target web --out-dir "$proof_dir/runtime-cache-wasm"
NEXORA_CANDIDATE_WASM="$proof_dir/runtime-cache-wasm" NEXORA_COMPARE_STAGE=16g NEXORA_STAGE16B_WASM="$proof_dir/stage16f-wasm" NEXORA_PROOF_DIR="$proof_dir/runtime-identity" node scripts/low-resolution-benchmark.mjs
node scripts/runtime-identity-gate.mjs

# Stage H is a separate opt-in path; never changes the ordinary historical builds.
if [[ "${NEXORA_INVERSE_HOTPATH:-0}" == 1 ]]; then
 cargo test --manifest-path engine/Cargo.toml --locked --features large_apex,inverse_hotpath
 cargo build --manifest-path engine/Cargo.toml --locked --release --target wasm32-unknown-unknown --features large_apex,inverse_hotpath -j2
 wasm-bindgen engine/target/wasm32-unknown-unknown/release/nexora_wasm.wasm --target web --out-dir "$proof_dir/inverse-hotpath-wasm"
 NEXORA_CANDIDATE_WASM="$proof_dir/inverse-hotpath-wasm" NEXORA_COMPARE_STAGE=16g NEXORA_STAGE16B_WASM="$proof_dir/stage16f-wasm" NEXORA_PROOF_DIR="$proof_dir/inverse-identity" node scripts/low-resolution-benchmark.mjs
 NEXORA_PROOF_DIR="$proof_dir/inverse-identity" NEXORA_IDENTITY_SUBDIR=. node scripts/runtime-identity-gate.mjs
fi
