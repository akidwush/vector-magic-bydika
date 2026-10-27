#!/usr/bin/env bash
# Fixed feature-only instrumentation, no normal WASM/dist replacement.
set -euo pipefail
cd "$(dirname "$0")/.."
root="${NEXORA_LEGACY_BUILDS:?fresh diagnostic modules directory}"
mkdir "$root"
for entry in 'diagnostic-reference legacy_work' 'diagnostic-hotpath legacy_work,inverse_hotpath'; do
 read -r label features <<< "$entry"
 cargo build --manifest-path engine/Cargo.toml --locked --release --target wasm32-unknown-unknown --features "$features" -j2
 wasm-bindgen engine/target/wasm32-unknown-unknown/release/nexora_wasm.wasm --target web --out-dir "$root/$label"
 node --input-type=module - "$root/$label" "$features" <<'JS'
import{writeFile,readFile}from'node:fs/promises';import{createHash}from'node:crypto';import{execFileSync}from'node:child_process';
const[dir,features]=process.argv.slice(2);const hash=b=>createHash('sha256').update(b).digest('hex');await writeFile(dir+'/manifest.json',JSON.stringify({commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),sourceDiffSHA256:hash(execFileSync('git',['diff','HEAD'])),features:features.split(','),wasmSHA256:hash(await readFile(dir+'/nexora_wasm_bg.wasm')),target:'wasm32-unknown-unknown',diagnostic:true,sourceFiles:Object.fromEntries(await Promise.all(['engine/src/legacy_work.rs','vendor/vtracer/src/runtime_work.rs','engine/src/lib.rs','engine/src/inverse.rs','engine/src/source_fit.rs','engine/src/recovery.rs','vendor/vtracer/src/frontend/color_cluster.rs','vendor/vtracer/src/fitter.rs'].map(async p=>[p,hash(await readFile(p))]))),policy:'Counters can perturb performance. Not claimed as a pinned F/H binary.'},null,2));
JS
done
