#!/usr/bin/env bash
# No retries. Every experiment gets a new namespace. App WASM/dist are untouched.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "${NEXORA_RUNTIME_STAGE:-16g}" == 16h ]]; then
 exec bash scripts/inverse-hotpath-research.sh
fi
proof="${NEXORA_RUNTIME_ROOT:-$PWD/benchmark-results/stage16g/runtime-$(git rev-parse --short HEAD)-$(date -u +%Y%m%dT%H%M%S)-$$}"
NEXORA_RUNTIME_ROOT="$proof" bash scripts/runtime-builds.sh
for pair in 'runtime_uncached P' 'runtime_profile Q' 'large_apex,runtime_cache G'; do
 read -r features label <<< "$pair"
 cargo build --manifest-path engine/Cargo.toml --locked --release --target wasm32-unknown-unknown --features "$features" -j2
 wasm-bindgen engine/target/wasm32-unknown-unknown/release/nexora_wasm.wasm --target web --out-dir "$proof/$label"
done
NEXORA_RUNTIME_BUILDS="{\"E\":\"$proof/E\",\"F\":\"$proof/F\",\"G\":\"$proof/G\"}" NEXORA_RUNTIME_PAIRS='[["E","E"],["F","F"],["E","F"],["F","G"]]' NEXORA_RUNTIME_ROOT="$proof/distributions" node scripts/runtime-benchmark.mjs
NEXORA_RUNTIME_BUILDS="{\"F\":\"$proof/P\",\"G\":\"$proof/Q\"}" NEXORA_RUNTIME_PAIRS='[["F","G"]]' NEXORA_RUNTIME_FIXTURES=triangle-128,triangle-512,cubic-1024,wave-1024,rounded-128,parallel-512 NEXORA_RUNTIME_REPETITIONS=2 NEXORA_RUNTIME_WARMS=2 NEXORA_RUNTIME_ROOT="$proof/profile" node scripts/runtime-benchmark.mjs
NEXORA_RUNTIME_ROOT="$proof" node scripts/runtime-reliability.mjs
