// Supplemental gate. Historical gates and thresholds are untouched.
import { readFile, writeFile } from "node:fs/promises";
import { sharedAtoms } from "./watershed-region-shared.mjs";
const root = process.env.NEXORA_ART_ROOT,
  rows = (await readFile(root + "/source-measure/measurements.jsonl", "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse),
  issues = [],
  changed = [],
  ids = [...new Set(rows.map((r) => r.image))];
const plan = JSON.parse(await readFile(root + "/plan.json"));
for (const image of plan.images) {
  for (const config of plan.configs) {
    if (!rows.some((r) => r.image === image.id && r.config === config.id))
      issues.push(image.id + ":" + config.id + ": missing actual measurement");
  }
}
for (const id of ids) {
  const a = rows.find((r) => r.image === id && r.config === "A-auto");
  if (!a) {
    issues.push(id + ": missingbaseline");
    continue;
  }
  for (const d of rows.filter(
    (r) => r.image === id && r.config === "combined",
  )) {
    if (d.svgSHA256 === a.svgSHA256) continue;
    const conv = (await readFile(root + "/conversions.jsonl", "utf8"))
        .trim()
        .split("\n")
        .map(JSON.parse)
        .find((r) => r.image === id && r.config.id === "combined"),
      shared = sharedAtoms(
        await readFile(root + "/" + conv.runs[0].export, "utf8"),
      );
    if (
      d.libvips.mae > a.libvips.mae + 1e-9 ||
      d.chromium.mae > a.chromium.mae + 1e-9
    )
      issues.push(id + ": sourceRGBAregression");
    if (
      d.complexity.embeddedRaster ||
      d.complexity.open ||
      d.complexity.withinPathCrossings > a.complexity.withinPathCrossings
    )
      issues.push(id + ": geometry/editability");
    if (shared.unmatched || shared.invalidMultiplicity)
      issues.push(id + ": sharededge mismatch");
    if (
      d.complexity.paths > a.complexity.paths + 24 ||
      d.complexity.anchors > a.complexity.anchors * 2 + 128
    )
      issues.push(id + ": complexity budget");
    if (!d.research[0]?.paint || d.research[0].paint.worseTiles !== 0)
      issues.push(id + ": missing native local proof");
    changed.push({ id, shared, before: a.libvips.mae, after: d.libvips.mae });
  }
}
const result = {
  status: issues.length ? "FAIL" : "PASS",
  images: ids.length,
  changed,
  issues,
  scope:
    "Safety nonregression, not milestone completion or original-vector accuracy. Native fixed8x8 local gate is additionally required. Independent rendering uses actual downloaded bytes.",
};
await writeFile(
  root + "/source-quality-gate.json",
  JSON.stringify(result, null, 2),
);
console.log(result);
if (issues.length) process.exitCode = 1;
