#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
root="${NEXORA_THIN_ENABLED:?fresh enabled-comparison namespace}"
base="${NEXORA_THIN_F_BASELINE:?isolated verified F binary directory}"
mkdir -p "$(dirname "$root")"; mkdir "$root"
root=$(cd "$root" && pwd)
cargo build --manifest-path engine/Cargo.toml --locked --release --target wasm32-unknown-unknown --features large_apex,inverse_hotpath,thin_feature_research -j2
wasm-bindgen engine/target/wasm32-unknown-unknown/release/nexora_wasm.wasm --target web --out-dir "$root/candidate"
node --input-type=module - "$root" <<'JS'
import{readFile,writeFile}from'node:fs/promises';import{createHash}from'node:crypto';import{execFileSync}from'node:child_process';
const mode=Number(process.env.NEXORA_THIN_MODE ?? 3);if(![3,4].includes(mode))throw Error('Unsupported research mode');const root=process.argv[2],p=root+'/candidate/nexora_wasm.js';let g=await readFile(p,'utf8');const marker='export { initSync, __wbg_init as default };';if(!g.includes(marker))throw Error('Binding changed');g=g.replace(marker,'export { initSync }; export default async function(...args){const core=await __wbg_init(...args);thin_research_configure('+mode+',false);return core;}');await writeFile(p,g);await writeFile(root+'/manifest.json',JSON.stringify({commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),features:['large_apex','inverse_hotpath','thin_feature_research'],mode,wasmSHA256:createHash('sha256').update(await readFile(root+'/candidate/nexora_wasm_bg.wasm')).digest('hex')},null,2));
JS
NEXORA_CANDIDATE_WASM="$root/candidate" NEXORA_STAGE16B_WASM="$base" NEXORA_COMPARE_STAGE=16g NEXORA_PROOF_DIR="$root" node scripts/low-resolution-benchmark.mjs
NEXORA_THIN_ENABLED="$root" node scripts/thin-feature-enabled-gate.mjs
