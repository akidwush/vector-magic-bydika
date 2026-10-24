#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Research exports are isolated from production src/engine/wasm.
cargo build --manifest-path engine/Cargo.toml --locked --release --target wasm32-unknown-unknown --features experiments -j 2
mkdir -p benchmark-results/quality/wasm
wasm-bindgen engine/target/wasm32-unknown-unknown/release/nexora_wasm.wasm --target web --out-dir benchmark-results/quality/wasm
NEXORA_RESEARCH=1 NEXORA_PORT=${NEXORA_RESEARCH_PORT:-4183} node scripts/serve-dist.mjs &
research_pid=$!
trap 'kill "$research_pid" 2>/dev/null || true' EXIT
node scripts/quality-experiment.mjs "$@"
