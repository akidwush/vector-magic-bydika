import { readFile, writeFile } from "node:fs/promises";
const rows = JSON.parse(
  await readFile("benchmark-results/stage16b/comparison.json"),
);
const failures = [];
for (const row of rows) {
  const base = row.variants.find((v) => v.key === "stage16"),
    c = row.variants.find((v) => v.key === "candidate");
  for (const k of ["mean", "p95", "max"])
    if (c.boundary[k] >= base.boundary[k] * 0.95)
      failures.push({
        name: row.name,
        metric: k,
        baseline: base.boundary[k],
        candidate: c.boundary[k],
        requirement: "at least 5% improvement",
      });
  if (
    c.structure?.properCrossings > base.structure?.properCrossings ||
    c.structure?.acuteTurnCount > base.structure?.acuteTurnCount
  )
    failures.push({ name: row.name, metric: "crossings or extra acute turns" });
  if (
    c.cornerPrecision < base.cornerPrecision ||
    c.cornerRecall < base.cornerRecall
  )
    failures.push({ name: row.name, metric: "corner retention" });
  if (c.libvips.mae > base.libvips.mae || c.chromium.mae > base.chromium.mae)
    failures.push({ name: row.name, metric: "source reconstruction" });
  if (c.ms > base.ms * 1.5)
    failures.push({ name: row.name, metric: "additional runtime exceeds 50%" });
}
await writeFile(
  "benchmark-results/stage16b/quality-gate.json",
  JSON.stringify(
    { status: failures.length ? "FAIL" : "PASS", failures },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    { status: failures.length ? "FAIL" : "PASS", failures },
    null,
    2,
  ),
);
if (failures.length) process.exitCode = 1;
