#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.."
root=${NEXORA_WATERSHED_VERIFY:?fresh directory};mkdir -p "$(dirname "$root")";mkdir "$root"||exit 1;root=$(cd "$root"&&pwd);status=0
record(){ local n=$1;shift;local c=0;"$@" > "$root/$n.log" 2>&1||c=$?;printf '%s\t%s\n' "$n" "$c" >> "$root/exit-status.tsv";if [[ $c != 0 ]];then status=1;fi;}
record wasm bash scripts/build-wasm.sh
record rust cargo test --manifest-path engine/Cargo.toml --locked
record source cargo test --manifest-path engine/Cargo.toml --locked --features source_geometry
record large cargo test --manifest-path engine/Cargo.toml --locked --features large_apex
record hotpath cargo test --manifest-path engine/Cargo.toml --locked --features large_apex,inverse_hotpath
record region cargo test --manifest-path engine/Cargo.toml --locked --features watershed_region_research
record combined cargo test --manifest-path engine/Cargo.toml --locked --features large_apex,inverse_hotpath,thin_feature_research,watershed_region_research
record upstream cargo test --manifest-path vendor/vtracer/Cargo.toml --locked --features watershed_region_research,thin_feature_research --lib
record unit npm test
record lint npm run lint
record typecheck npm run typecheck
record build npm run build
record browser env NEXORA_STAGE15_ROOT="$root/regression" NEXORA_BROWSER_EVIDENCE_ROOT="$root/browser" bash scripts/isolated-browser-evidence.sh npm run test:e2e -- --output="$root/e2e"
record offline env NEXORA_ART_VERIFY="$root" bash scripts/real-artwork-offline-quality.sh
exit "$status"
