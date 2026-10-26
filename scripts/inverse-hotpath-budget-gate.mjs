// Additional H/F runtime check on actual 45-case exports. Historical files and
// their assertions remain unchanged; this does not replace their full suite.
import { readFile, writeFile } from "node:fs/promises";
const root = process.env.NEXORA_PROOF_DIR;
if (!root) throw Error("Set completed isolated hotpath proof root");
const rows = JSON.parse(
  await readFile(root + "/runtime-identity/low-resolution/comparison.json"),
);
const failures = [];
if (rows.length !== 45)
  failures.push({ key: "suite", reason: "45 pairs required" });
for (const r of rows) {
  const [b, c] = r.variants;
  const median = (v) => [v.ms, ...v.warmMs].sort((a, b) => a - b)[1];
  if (!r.unchanged || b.autoHash !== c.autoHash)
    failures.push({ key: r.key, reason: "SVG/Auto identity" });
  if (median(c) > median(b) + 500)
    failures.push({
      key: r.key,
      reason: "added median CPU >500ms",
      baseline: median(b),
      candidate: median(c),
    });
  if (r.key === "triangle-eight-native-srgb-128") {
    const events = [];
    for (let i = 0; i < (c.largeApex?.length || 0); i += 48)
      events.push(c.largeApex.slice(i, i + 48));
    const local = events.find((e) => e[0] === 30);
    if (!local || !(local[41] < 250))
      failures.push({
        key: r.key,
        reason: "extended apex CPU >250ms or missing certificate",
        apexMs: local?.[41],
      });
  }
}
const result = {
  status: failures.length ? "FAIL" : "PASS",
  cases: rows.length,
  failures,
  scope:
    "Additional H/F byte-identity, unchanged +500ms paired median and 250ms certified-apex budgets only; historical percentage/geometry gates still run separately.",
};
await writeFile(
  root + "/runtime-identity/hotpath-budget-gate.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exitCode = 1;
