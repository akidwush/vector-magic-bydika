#!/usr/bin/env bash
# Isolated build; never replaces normal WASM/dist or enables a global feature.
set -euo pipefail
cd "$(dirname "$0")/.."
root="${NEXORA_ART_BUILDS:?Fresh isolated module directory}"
mkdir -p "$(dirname "$root")"; mkdir "$root"
if ! git cat-file -e ce63c7202f2f0836b2123036b8e24db939ffa420^{commit} 2>/dev/null; then git fetch --depth=1 origin ce63c7202f2f0836b2123036b8e24db939ffa420; fi
git diff --exit-code ce63c7202f2f0836b2123036b8e24db939ffa420 -- engine vendor src
for entry in 'production default' 'geometry-f large_apex' 'hotpath-h large_apex,inverse_hotpath'; do
 read -r name features <<< "$entry"
 args=(); if [[ "$features" != default ]]; then args=(--features "$features"); fi
 cargo build --manifest-path engine/Cargo.toml --locked --release --target wasm32-unknown-unknown "${args[@]}" -j2
 wasm-bindgen engine/target/wasm32-unknown-unknown/release/nexora_wasm.wasm --target web --out-dir "$root/$name"
 node --input-type=module - "$root/$name" "$features" <<'JS'
import{readFile,writeFile}from'node:fs/promises';import{execFileSync}from'node:child_process';import{createHash}from'node:crypto';
const[dir,features]=process.argv.slice(2);const hash=b=>createHash('sha256').update(b).digest('hex');await writeFile(dir+'/manifest.json',JSON.stringify({baseline:'ce63c7202f2f0836b2123036b8e24db939ffa420',commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),features:features==='default'?[]:features.split(','),wasmSHA256:hash(await readFile(dir+'/nexora_wasm_bg.wasm')),glueSHA256:hash(await readFile(dir+'/nexora_wasm.js')),engineTree:execFileSync('git',['rev-parse','ce63c7202f2f0836b2123036b8e24db939ffa420:engine'],{encoding:'utf8'}).trim(),policy:'Current engine equals verified J baseline. No profiling/cache feature. Source-guided features remain isolated.'},null,2));
JS
done
NEXORA_ART_BUILDS="$root" node scripts/real-artwork-builds.mjs
