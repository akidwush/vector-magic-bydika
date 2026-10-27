#!/usr/bin/env bash
# Actual selected experimental application, always restoring normal imports/dist.
set -euo pipefail
cd "$(dirname "$0")/.."
root="${NEXORA_THIN_BROWSER:?fresh browser evidence root}"
module="${NEXORA_THIN_BROWSER_MODULE:?exact selected binding directory}"
mkdir -p "$(dirname "$root")"; mkdir "$root";root=$(cd "$root" && pwd)
backup=$(mktemp -d /tmp/nexora-thin-browser-XXXXXX)
cp -a src/engine/wasm "$backup/wasm"
if [[ -d dist ]]; then cp -a dist "$backup/dist"; fi
cleanup(){ local code=$?;trap - EXIT;cp -a "$backup/wasm/." src/engine/wasm/ || code=1;if [[ -d dist ]];then mv dist "$backup/tested-dist" || code=1;fi;if [[ -d "$backup/dist" ]];then mv "$backup/dist" dist || code=1;fi;rm -rf "$backup";exit "$code"; }
trap cleanup EXIT
cp "$module/nexora_wasm.js" "$module/nexora_wasm_bg.wasm" src/engine/wasm/
node --input-type=module - "$module" "$root" <<'JS'
import{readFile,writeFile}from'node:fs/promises';import{createHash}from'node:crypto';const module=process.argv[2],root=process.argv[3],hash=b=>createHash('sha256').update(b).digest('hex');await writeFile(root+'/binary.json',JSON.stringify({module,wasm:hash(await readFile(module+'/nexora_wasm_bg.wasm')),glue:hash(await readFile(module+'/nexora_wasm.js')),policy:'Normal application rebuilt with exact selected opt-in module; cleanup restores production artifacts.'},null,2));
JS
npm run build
NEXORA_LARGE_APEX=1 NEXORA_STAGE15_ROOT="$root/regression" NEXORA_LOW_RES_ROOT="$root/low-resolution" NEXORA_TEST_PORT="${NEXORA_TEST_PORT:-4187}" NEXORA_BROWSER_EVIDENCE_ROOT="$root/browser" bash scripts/isolated-browser-evidence.sh npm run test:e2e -- --output="$root/e2e"
