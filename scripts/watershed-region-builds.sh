#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
root=${NEXORA_WATERSHED_BUILDS:?fresh isolated modules directory}
mkdir -p "$(dirname "$root")";mkdir "$root";root=$(cd "$root" && pwd)
git diff --binary > "$root/working.patch"
mkdir "$root/source"
cp -r engine/src "$root/source/engine-src"
cp -r vendor/vtracer/src "$root/source/vendor-src"
cp engine/Cargo.toml engine/Cargo.lock "$root/source/"
# Exact baseline binary is isolated; neither normal bindings nor dist are touched.
work=$(mktemp -d /tmp/nexora-watershed-base-XXXXXX)
cleanup(){ local code=$?;trap - EXIT;git worktree remove "$work" || code=1;exit "$code"; }
trap cleanup EXIT
git worktree add --detach "$work" ad770ad49b6168a75c1751bfbed412aad824fc15
CARGO_TARGET_DIR="$PWD/engine/target" cargo build --manifest-path "$work/engine/Cargo.toml" --locked --release --target wasm32-unknown-unknown -j2
wasm-bindgen engine/target/wasm32-unknown-unknown/release/nexora_wasm.wasm --target web --out-dir "$root/baseline"
CARGO_TARGET_DIR="$PWD/engine/target" cargo build --manifest-path "$work/engine/Cargo.toml" --locked --release --target wasm32-unknown-unknown --features thin_feature_research -j2
wasm-bindgen engine/target/wasm32-unknown-unknown/release/nexora_wasm.wasm --target web --out-dir "$root/thin-source"
cargo build --manifest-path engine/Cargo.toml --locked --release --target wasm32-unknown-unknown --features watershed_region_research -j2
wasm-bindgen engine/target/wasm32-unknown-unknown/release/nexora_wasm.wasm --target web --out-dir "$root/research"
NEXORA_WATERSHED_BUILDS="$root" node scripts/watershed-region-builds.mjs
