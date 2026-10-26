#!/usr/bin/env bash
# Immutable historical modules; never writes the app's WASM/dist.
set -euo pipefail
cd "$(dirname "$0")/.."
repo="$PWD"
proof="${NEXORA_RUNTIME_ROOT:?Set a fresh runtime artifact directory}"
mkdir -p "$(dirname "$proof")"
mkdir "$proof"
work=""
trap 'if [[ -n "$work" ]]; then git worktree remove "$work"; fi' EXIT
for entry in '0b67da0cce87476adc59acc7396eb8cfd542452a E source_geometry' 'c7f47512598cec01ad0adc9516af94e3ff58c963 F large_apex'; do
 read -r revision label features <<< "$entry"
 if ! git cat-file -e "$revision^{commit}" 2>/dev/null; then git fetch --depth=1 origin "$revision"; fi
 work=$(mktemp -d /tmp/nexora-runtime-baseline-XXXXXX)
 git worktree add --detach "$work" "$revision"
 CARGO_TARGET_DIR="$repo/engine/target" cargo build --manifest-path "$work/engine/Cargo.toml" --locked --release --target wasm32-unknown-unknown --features "$features" -j2
 wasm-bindgen engine/target/wasm32-unknown-unknown/release/nexora_wasm.wasm --target web --out-dir "$proof/$label"
 git worktree remove "$work"
 work=""
done
