#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
cargo build --manifest-path engine/Cargo.toml --locked --release --target wasm32-unknown-unknown --features experiments -j 2
mkdir -p benchmark-results/quality/wasm
wasm-bindgen engine/target/wasm32-unknown-unknown/release/nexora_wasm.wasm --target web --out-dir benchmark-results/quality/wasm
NEXORA_CANDIDATE="${NEXORA_CANDIDATE:-coverage}" node scripts/coverage-research.mjs --full
