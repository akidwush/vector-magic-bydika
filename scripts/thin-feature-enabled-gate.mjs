// Additional research gate, leaving all historical gates/thresholds untouched.
import { readFile, writeFile } from "node:fs/promises";
const root = process.env.NEXORA_THIN_ENABLED,
  rows = JSON.parse(await readFile(root + "/low-resolution/comparison.json"));
const errors = [],
  changes = [];
if (rows.length !== 45) errors.push("45 exported comparisons required");
const protectedKeys = new Set([
  "cubic-128",
  "cubic-512",
  "cubic-1024",
  "wave-128",
  "wave-512",
  "wave-1024",
  "triangle-eight-native-srgb-128",
  "triangle-eight-native-srgb-512",
  "triangle-eight-native-srgb-1024",
]);
for (const r of rows) {
  const [b, c] = r.variants;
  if (!r.unchanged) changes.push(r.key);
  if (c.structure.properCrossings > b.structure.properCrossings)
    errors.push(r.key + " new crossing");
  if (c.structure.closed !== b.structure.closed || c.paths !== b.paths)
    errors.push(
      r.key +
        " contour ownership/closure changed; requires separate topology review",
    );
  if (protectedKeys.has(r.key)) {
    if (!r.unchanged) errors.push(r.key + " protected output changed");
    for (const m of ["mean", "p95", "max"])
      if (c.geometry[m] > b.geometry[m] + 1e-9)
        errors.push(r.key + " boundary " + m);
    if (
      c.cornerAccuracy.precision < b.cornerAccuracy.precision ||
      c.cornerAccuracy.recall < b.cornerAccuracy.recall
    )
      errors.push(r.key + " corner retention");
  }
}
const result = {
  status: errors.length ? "FAIL" : "PASS",
  cases: rows.length,
  changed: changes,
  errors,
  scope:
    "Feature enabled. Nine protected exact exports; all 45 ownership/closure/proper-crossing nonregression. Historical CPU and geometry gates remain separate and blocking.",
};
await writeFile(root + "/enabled-gate.json", JSON.stringify(result, null, 2));
console.log(result);
if (errors.length) process.exitCode = 1;
