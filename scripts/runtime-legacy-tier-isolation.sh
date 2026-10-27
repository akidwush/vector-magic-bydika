#!/usr/bin/env bash
# One diagnostic factor: eager optimizing compilation. NEVER a production flag.
set -euo pipefail
cd "$(dirname "$0")/.."
root="${NEXORA_TIER_ROOT:?Fresh tier-isolation namespace}"
mkdir "$root"
cat > "$root/plan.json" <<'JSON'
{"sessions":4,"order":["default","no-liftoff","no-liftoff","default"],"fixture":"wave-1024","conditions":["original-uninstrumented-callback","marked-sampled-callback"],"timedCalls":48,"hypothesis":"Cold baseline execution/tiering may contribute to component extraction CPU inflation. Eager optimizing compilation predicts lower cold binding CPU at the cost of initialization.","limitation":"Native compilation logs perturb the experiment. Flags must be verified from actual compiler records. Even a positive result cannot by itself establish the cause of the historical 10.67s episode. No retries."}
JSON
status=0
for session in 0 1 2 3; do
 label=default
 flags=--trace-wasm-compilation-times
 if [[ $session == 1 || $session == 2 ]]; then label=no-liftoff; flags='--no-liftoff --trace-wasm-compilation-times'; fi
 code=0
 DEBUG=pw:browser NEXORA_LEGACY_JS_FLAGS="$flags" NEXORA_LEGACY_SESSIONS=1 NEXORA_LEGACY_FIXTURES=wave-1024 NEXORA_LEGACY_ROOT="$root/s$session-$label" node scripts/runtime-legacy-cpu-forensics.mjs > "$root/s$session-$label.log" 2>&1 || code=$?
 printf '%s\t%s\n' "s$session-$label" "$code" >> "$root/exit-status.tsv"
 if [[ $code != 0 ]]; then status=1; fi
done
exit "$status"
