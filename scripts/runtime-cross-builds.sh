#!/usr/bin/env bash
# Pin source revisions; never writes src/engine/wasm or normal dist.
set -euo pipefail
cd "$(dirname "$0")/.."
root="${NEXORA_CROSS_ROOT:?Set a fresh artifact root}"
mkdir -p "$(dirname "$root")"; mkdir "$root"
repo="$PWD"; work=""
trap 'if [[ -n "$work" ]]; then git worktree remove "$work"; fi' EXIT
for entry in 'c7f47512598cec01ad0adc9516af94e3ff58c963 stage16f large_apex' '7772a310e0e263caa0ead59eb14528b55aea439f stage16h large_apex,inverse_hotpath' '3268ab3fb15c0ce650bc45ab3ff9b0c458f9b2d4 diagnostic-reference runtime_uncached' '3268ab3fb15c0ce650bc45ab3ff9b0c458f9b2d4 diagnostic-hotpath runtime_uncached,inverse_hotpath'; do
 read -r revision label features <<< "$entry"
 if ! git cat-file -e "$revision^{commit}" 2>/dev/null; then git fetch --depth=1 origin "$revision"; fi
 work=$(mktemp -d /tmp/nexora-cross-build-XXXXXX)
 git worktree add --detach "$work" "$revision"
 CARGO_TARGET_DIR="$repo/engine/target" cargo build --manifest-path "$work/engine/Cargo.toml" --locked --release --target wasm32-unknown-unknown --features "$features" -j2
 wasm-bindgen engine/target/wasm32-unknown-unknown/release/nexora_wasm.wasm --target web --out-dir "$root/$label"
 node --input-type=module - "$root/$label" "$revision" "$features" <<'JS'
import{writeFile,readFile}from'node:fs/promises';import{createHash}from'node:crypto';
const[dir,commit,features]=process.argv.slice(2);await writeFile(dir+'/manifest.json',JSON.stringify({commit,features:features.split(','),wasmSHA256:createHash('sha256').update(await readFile(dir+'/nexora_wasm_bg.wasm')).digest('hex'),target:'wasm32-unknown-unknown',diagnostic:features.includes('runtime_'),policy:'Source pinned; immutable binary reused in every execution pathway.'},null,2));
JS
 git worktree remove "$work";work=""
done
NEXORA_CROSS_ROOT="$root" node scripts/runtime-cross-apps.mjs
