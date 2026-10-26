#!/usr/bin/env bash
# Legacy specs contain fixed report paths. Keep old bytes immutable and retain
# this invocation's reports separately, including on failed/cancelled tests.
set -euo pipefail
cd "$(dirname "$0")/.."
root="${NEXORA_BROWSER_EVIDENCE_ROOT:?Set a fresh browser evidence directory}"
mkdir -p "$(dirname "$root")"
mkdir "$root"
backup=$(mktemp -d /tmp/nexora-browser-reports-XXXXXX)
paths=(stage14 coverage stage13 shared-edge source-quality stage12 baseline.json)
cleanup(){
 local code=$?;trap - EXIT
 for name in "${paths[@]}"; do
  if [[ -e "benchmark-results/$name" ]]; then mv "benchmark-results/$name" "$root/$name" || code=1; fi
  if [[ -e "$backup/$name" ]]; then mv "$backup/$name" "benchmark-results/$name" || code=1; fi
 done
 if [[ -d playwright-report ]]; then mv playwright-report "$root/playwright-report" || code=1; fi
 if [[ -d "$backup/playwright-report" ]]; then mv "$backup/playwright-report" playwright-report || code=1; fi
 rm -rf "$backup"
 exit "$code"
}
trap cleanup EXIT
for name in "${paths[@]}"; do
 if [[ -e "benchmark-results/$name" ]]; then mv "benchmark-results/$name" "$backup/$name"; fi
done
if [[ -d playwright-report ]]; then mv playwright-report "$backup/playwright-report"; fi
"$@"
