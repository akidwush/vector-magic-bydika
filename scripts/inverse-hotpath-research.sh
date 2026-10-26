#!/usr/bin/env bash
# Stage H orchestration of the Stage G harness; no retries or app build mutations.
set -euo pipefail
cd "$(dirname "$0")/.."
proof="${NEXORA_RUNTIME_ROOT:-$PWD/benchmark-results/stage16h/runtime-$(git rev-parse --short HEAD)-$(date -u +%Y%m%dT%H%M%S)-$$}"
NEXORA_RUNTIME_STAGE=16h NEXORA_RUNTIME_ROOT="$proof" bash scripts/runtime-builds.sh
for pair in 'large_apex,inverse_hotpath G' 'runtime_uncached U' 'runtime_uncached,inverse_hotpath V'; do
 read -r features label <<< "$pair"
 cargo build --manifest-path engine/Cargo.toml --locked --release --target wasm32-unknown-unknown --features "$features" -j2
 wasm-bindgen engine/target/wasm32-unknown-unknown/release/nexora_wasm.wasm --target web --out-dir "$proof/$label"
done
# E is pinned Stage G opt-in cache, F is pinned Stage F, G is Stage H.
export NEXORA_RUNTIME_FIXTURES="${NEXORA_RUNTIME_FIXTURES:-cubic-128,cubic-512,cubic-1024,wave-128,wave-512,wave-1024,triangle-128,triangle-512,triangle-1024,thin-ellipse-1024,blade-512,rounded-128,parallel-512}"
NEXORA_RUNTIME_BUILDS="{\"E\":\"$proof/E\",\"F\":\"$proof/F\",\"G\":\"$proof/G\"}" NEXORA_RUNTIME_PAIRS='[["F","F"],["F","G"],["E","G"]]' NEXORA_RUNTIME_ROOT="$proof/distributions" node scripts/runtime-benchmark.mjs
NEXORA_RUNTIME_BUILDS="{\"F\":\"$proof/U\",\"G\":\"$proof/V\"}" NEXORA_RUNTIME_PAIRS='[["F","G"]]' NEXORA_RUNTIME_FIXTURES=cubic-1024,wave-1024,triangle-128,triangle-512,thin-ellipse-1024,rounded-128,parallel-512 NEXORA_RUNTIME_REPETITIONS=2 NEXORA_RUNTIME_WARMS=2 NEXORA_RUNTIME_ROOT="$proof/profile" node scripts/runtime-benchmark.mjs
NEXORA_RUNTIME_ROOT="$proof" node scripts/runtime-reliability.mjs
NEXORA_RUNTIME_ROOT="$proof" node scripts/inverse-hotpath-analysis.mjs
