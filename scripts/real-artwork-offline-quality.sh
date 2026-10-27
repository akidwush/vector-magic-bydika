#!/usr/bin/env bash
# Old scripts use fixed paths. Resolve them only inside this run's private namespace.
set -uo pipefail
repo="$PWD"
root="${NEXORA_ART_VERIFY:?Absolute fresh verification root}"
work="$root/offline-workspace"
mkdir "$work"; mkdir "$work/benchmark-results"
for name in scripts tests src node_modules; do ln -s "$repo/$name" "$work/$name"; done
ln -s "$root/e2e" "$work/test-results"
for name in stage13 stage14 coverage shared-edge; do
 if [[ -e "$root/browser/$name" ]]; then ln -s "$root/browser/$name" "$work/benchmark-results/$name"; fi
done
cd "$work"
status=0
for name in source-quality-evidence curve-optimization-evidence; do
 code=0
 node "scripts/$name.mjs" > "$root/$name.log" 2>&1 || code=$?
 printf '%s\t%s\n' "$name" "$code" >> "$root/offline-quality-status.tsv"
 if [[ $code != 0 ]]; then status=1; fi
done
exit "$status"
