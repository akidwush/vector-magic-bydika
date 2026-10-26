#!/usr/bin/env bash
# Separate immutable namespace; no retries, old gate edits or app build mutations.
set -euo pipefail
cd "$(dirname "$0")/.."
root="${NEXORA_CROSS_ROOT:-$PWD/benchmark-results/stage16i/cross-$(git rev-parse --short HEAD)-$(date -u +%Y%m%dT%H%M%S)-$$}"
mkdir -p "$(dirname "$root")"
mkdir "$root"
NEXORA_CROSS_ROOT="$root/modules" bash scripts/runtime-cross-builds.sh
export NEXORA_CROSS_BUILDS="$root/modules"
status=0
record(){
 local name=$1; shift
 local code=0
 "$@" > "$root/$name.log" 2>&1 || code=$?
 printf '%s\t%s\n' "$name" "$code" >> "$root/exit-status.tsv"
 if [[ $code != 0 ]]; then status=1; fi
}
record matched env NEXORA_CROSS_ROOT="$root/matched" node scripts/runtime-cross-harness.mjs
record matched-analysis env NEXORA_CROSS_ROOT="$root/matched" node scripts/runtime-cross-analysis.mjs
record diagnostic env NEXORA_CROSS_ROOT="$root/diagnostic" NEXORA_CROSS_MODULES=diagnostic-reference,diagnostic-hotpath NEXORA_CROSS_SESSIONS=2 NEXORA_CROSS_WARMS=2 node scripts/runtime-cross-harness.mjs
record diagnostic-analysis env NEXORA_CROSS_ROOT="$root/diagnostic" node scripts/runtime-cross-analysis.mjs
record dispatch env NEXORA_DISPATCH_ROOT="$root/dispatch" node scripts/runtime-dispatch-isolation.mjs
record trace-control env NEXORA_CROSS_ROOT="$root/trace-control" NEXORA_CROSS_FIXTURES=wave-1024,rounded-1024 NEXORA_CROSS_TRACE_PATTERN=on,off,off,on,on,off NEXORA_CROSS_SESSIONS=6 NEXORA_CROSS_WARMS=2 node scripts/runtime-cross-harness.mjs
record trace-control-analysis env NEXORA_CROSS_ROOT="$root/trace-control" node scripts/runtime-cross-analysis.mjs
# Actual historical direct-export pathway using the SAME primary F/H binaries.
record exact-exports env NEXORA_CANDIDATE_WASM="$root/modules/stage16h" NEXORA_STAGE16B_WASM="$root/modules/stage16f" NEXORA_COMPARE_STAGE=16g NEXORA_PROOF_DIR="$root/exact-exports/runtime-identity" node scripts/low-resolution-benchmark.mjs
record exact-identity env NEXORA_PROOF_DIR="$root/exact-exports" node scripts/runtime-identity-gate.mjs
record exact-budget env NEXORA_PROOF_DIR="$root/exact-exports" node scripts/inverse-hotpath-budget-gate.mjs
record exact-editability env NEXORA_PROOF_DIR="$root/exact-exports/runtime-identity" node scripts/low-resolution-editability.mjs
exit "$status"
