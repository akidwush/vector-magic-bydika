import { readFile, writeFile } from "node:fs/promises";
const root = process.env.NEXORA_PROOF_DIR;
if (!root) throw Error("Set isolated runtime geometry proof root");
const rows = JSON.parse(
  await readFile(root + "/runtime-identity/low-resolution/comparison.json"),
);
const failures = [];
if (rows.length !== 45) failures.push("45 pairs required");
for (const row of rows) {
  if (!row.unchanged) failures.push(row.key + " SVG bytes changed");
  if (row.variants[0].autoHash !== row.variants[1].autoHash)
    failures.push(row.key + " Auto changed");
}
const result = {
  status: failures.length ? "FAIL" : "PASS",
  cases: rows.length,
  failures,
  scope:
    "Stage1.6F versus runtime-optimized exact SVG and Auto identity; no performance threshold is replaced",
};
await writeFile(
  root + "/runtime-identity/identity-gate.json",
  JSON.stringify(result, null, 2),
);
console.log(result);
if (failures.length) process.exitCode = 1;
