#!/usr/bin/env bash
# Existing45 actual exports and old gate, feature-enabled as explicit comparator.
set -euo pipefail
cd "$(dirname "$0")/.."
root=${NEXORA_WATERSHED_ENABLED:?fresh directory};base=${NEXORA_WATERSHED_F:?immutable F bindings}
mkdir -p "$(dirname "$root")";mkdir "$root";root=$(cd "$root"&&pwd)
cargo build --manifest-path engine/Cargo.toml --locked --release --target wasm32-unknown-unknown --features large_apex,inverse_hotpath,watershed_region_research -j2
wasm-bindgen engine/target/wasm32-unknown-unknown/release/nexora_wasm.wasm --target web --out-dir "$root/candidate"
node --input-type=module - "$root" <<'JS'
import{readFile,writeFile}from'node:fs/promises';import{createHash}from'node:crypto';
const root=process.argv[2],p=root+'/candidate/nexora_wasm.js',end='export { initSync, __wbg_init as default };';let s=await readFile(p,'utf8');if(!s.includes(end))throw Error('Binding changed');s=s.replace(end,'export {initSync};export default async function(...args){const w=await __wbg_init(...args);watershed_research_configure(3);thin_research_configure(0,false);return w;}');await writeFile(p,s);await writeFile(root+'/manifest.json',JSON.stringify({features:['large_apex','inverse_hotpath','watershed_region_research'],mode:3,wasmSHA256:createHash('sha256').update(await readFile(root+'/candidate/nexora_wasm_bg.wasm')).digest('hex')},null,2));
JS
NEXORA_CANDIDATE_WASM="$root/candidate" NEXORA_STAGE16B_WASM="$base" NEXORA_COMPARE_STAGE=16g NEXORA_PROOF_DIR="$root" node scripts/low-resolution-benchmark.mjs
NEXORA_THIN_ENABLED="$root" node scripts/thin-feature-enabled-gate.mjs
