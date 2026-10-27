#!/usr/bin/env bash
# Bounded post-hoc frontend isolation; never changes Auto or classifier thresholds.
set -uo pipefail
cd "$(dirname "$0")/.."
root="${NEXORA_THIN_FRONTEND_ROOT:?fresh supplementary namespace}"
mkdir -p "$(dirname "$root")";mkdir "$root" || exit 1;root=$(cd "$root" && pwd)
status=0
record(){ local name=$1;shift;local code=0;"$@" > "$root/$name.log" 2>&1 || code=$?;printf '%s\t%s\n' "$name" "$code" >> "$root/exit-status.tsv";if [[ "$code" != 0 ]];then status=1;fi;}
cat > "$root/configs.json" <<'JSON'
[{"id":"P-planar-baseline","module":"baseline-auto","quality":"planar","optimize":true,"sourceRefine":false},{"id":"Q-planar-negative","module":"thin-negative","quality":"planar","optimize":true,"sourceRefine":false}]
JSON
cat > "$root/protocol.json" <<'JSON'
{"scope":"POST_HOC_FRONTEND_ISOLATION","selection":"Auto orbital-badge reached Watershed and executed zero ColorCluster predicates; use the existing planar UI profile on both binaries and every fixed case. No Auto change, new thresholds or reference input. This is not unbiased Auto generalization.","timing":"Retain all clocks but do not compare them with Auto as an engine speedup. The original local exploration overlapped offline scoring; this reproducer is serial."}
JSON
export NEXORA_ART_ROOT="$root/evaluation" NEXORA_ART_CONFIGS_FILE="$root/configs.json" NEXORA_ART_IMAGES=circuit-ribbon-128,circuit-ribbon-512,stencil-kite-128,stencil-kite-512,ribbon-garden-128,ribbon-garden-512,orbital-badge-128,orbital-badge-512,original-anime-128-jpeg,original-anime-512-webp,twemoji-fox-128-jpeg,original-garden-512-noise NEXORA_ART_ROUNDTRIP_CONFIGS=P-planar-baseline,Q-planar-negative
unset NEXORA_ART_CONFIGS
record conversion node scripts/real-artwork-benchmark.mjs
record analysis node scripts/real-artwork-analyze.mjs
export NEXORA_THIN_BASELINE_RUN="$root/evaluation" NEXORA_THIN_BASELINE_ID=P-planar-baseline NEXORA_THIN_CANDIDATE_ID=Q-planar-negative NEXORA_THIN_MODE=4 NEXORA_THIN_IMAGES=orbital-badge-128,original-garden-512-noise NEXORA_THIN_DIAG_ROOT="$root/diagnosis"
record diagnosis node scripts/thin-feature-diagnose.mjs
record local-proof env NEXORA_THIN_EVALUATION="$root/evaluation" NEXORA_THIN_LOCAL_DIAG_ROOT="$root/diagnosis" NEXORA_THIN_LOCAL_STRICT=1 node scripts/thin-feature-local-proof.mjs
record visuals env NEXORA_THIN_EVALUATION="$root/evaluation" NEXORA_THIN_VISUAL_IMAGES=orbital-badge-128 node scripts/thin-feature-visuals.mjs
exit "$status"
