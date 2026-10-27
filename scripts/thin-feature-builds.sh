#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
root="${NEXORA_THIN_BUILDS:?fresh build directory}"
mkdir -p "$(dirname "$root")";mkdir "$root";root=$(cd "$root" && pwd)
git diff --binary > "$root/working.patch"
node --input-type=module - "$root" <<'JS'
import{mkdir,cp,readdir,readFile,writeFile}from'node:fs/promises';import{createHash}from'node:crypto';
const root=process.argv[2];await mkdir(root+'/source',{recursive:true});
for(const p of['engine/src','vendor/vtracer/src','engine/Cargo.toml','engine/Cargo.lock','vendor/vtracer/Cargo.toml','vendor/vtracer/Cargo.lock','vendor/vtracer/LICENSE'])await cp(p,root+'/source/'+p,{recursive:true});
const files=[];async function walk(dir){for(const e of await readdir(root+'/source/'+dir,{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())await walk(p);else files.push({file:p,sha256:createHash('sha256').update(await readFile(root+'/source/'+p)).digest('hex')});}}
await walk('engine');await walk('vendor');await writeFile(root+'/source-manifest.json',JSON.stringify(files.sort((a,b)=>a.file.localeCompare(b.file)),null,2));
JS
work=$(mktemp -d /tmp/nexora-thin-baseline-XXXXXX)
cleanup(){ local code=$?;trap - EXIT;git worktree remove "$work" || code=1;exit "$code"; }
trap cleanup EXIT
base=ca3871e14ca633aad09503e78681631348d71b75
if ! git cat-file -e "$base^{commit}" 2>/dev/null; then git fetch --depth=1 origin "$base";fi
git worktree add --detach "$work" "$base"
CARGO_TARGET_DIR="$PWD/engine/target" cargo build --manifest-path "$work/engine/Cargo.toml" --locked --release --target wasm32-unknown-unknown -j2
wasm-bindgen engine/target/wasm32-unknown-unknown/release/nexora_wasm.wasm --target web --out-dir "$root/baseline-auto"
cargo build --manifest-path engine/Cargo.toml --locked --release --target wasm32-unknown-unknown --features thin_feature_research -j2
wasm-bindgen engine/target/wasm32-unknown-unknown/release/nexora_wasm.wasm --target web --out-dir "$root/research"
NEXORA_THIN_BUILDS="$root" node scripts/thin-feature-builds.mjs
