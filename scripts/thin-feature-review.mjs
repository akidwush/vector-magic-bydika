// Additional independently reported research criteria. Never rewrites an old verdict.
import { readFile, writeFile } from "node:fs/promises";
const root = process.env.NEXORA_THIN_EVALUATION;
if (!root) throw Error("Completed immutable evaluation required");
const rows = (await readFile(root + "/analysis/measurements.jsonl", "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse),
  conversions = (await readFile(root + "/conversions.jsonl", "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
const ids = [...new Set(rows.map((r) => r.image))],
  failures = [],
  pairs = [];
const expectedImages = Number(process.env.NEXORA_THIN_EXPECT_IMAGES ?? 37);
if (ids.length !== expectedImages || rows.length !== 3 * expectedImages)
  failures.push(
    `${expectedImages} images / ${3 * expectedImages} measured outputs required`,
  );
const negatives = new Set([
  "original-anime-512-webp",
  "original-anime-128-jpeg",
  "twemoji-fox-128-jpeg",
  "original-garden-512-noise",
]);
for (const id of ids) {
  const b = rows.find((r) => r.image === id && r.config.id === "A-auto"),
    o = rows.find((r) => r.image === id && r.config.id === "thin-observe"),
    c = rows.find(
      (r) =>
        r.image === id &&
        r.config.id ===
          (process.env.NEXORA_THIN_CANDIDATE_ID ?? "thin-structural"),
    );
  if (!b || !o || !c) {
    failures.push(id + " missing comparison");
    continue;
  }
  if (b.svgSHA256 !== o.svgSHA256)
    failures.push(id + " unconfigured observer changed SVG");
  if (negatives.has(id) && b.svgSHA256 !== c.svgSHA256)
    failures.push(id + " codec/noise control changed");
  if (c.complexity.embeddedRaster || c.complexity.open > b.complexity.open)
    failures.push(id + " editable/closed-path regression");
  if (c.complexity.withinPathCrossings > b.complexity.withinPathCrossings)
    failures.push(id + " new crossing suspect needs rejection/review");
  if (c.libvips.alphaMae > b.libvips.alphaMae + 1e-9)
    failures.push(id + " alpha regression");
  const records =
    conversions.find((r) => r.id === c.id)?.worker.regionResearch ?? [];
  for (const v of records) {
    if (
      v.sourceRetained ||
      v.cacheEntries ||
      v.protected > 64 ||
      v.chargedCandidatePixels > 1_000_000 ||
      v.negativeProbeCellBudget > 1_000_000 ||
      v.negativeProbePixelsVisited > v.negativeProbeCellBudget
    )
      failures.push(id + " research resource/cleanup contract");
  }
  pairs.push({
    image: id,
    split: c.split,
    family: c.family,
    unchanged: b.svgSHA256 === c.svgSHA256,
    baseline: { ...pick(b) },
    candidate: { ...pick(c) },
    research: records,
    delta: {
      mae: c.libvips.mae - b.libvips.mae,
      chromiumMae: c.chromium.mae - b.chromium.mae,
      holes:
        (c.libvips.outputMask?.negativeSpaces ?? 0) -
        (b.libvips.outputMask?.negativeSpaces ?? 0),
      objects:
        (c.libvips.outputMask?.objects ?? 0) -
        (b.libvips.outputMask?.objects ?? 0),
      paths: c.complexity.paths - b.complexity.paths,
      anchors: c.complexity.anchors - b.complexity.anchors,
    },
    scope:
      "Visible components use unchanged 4FG/8BG >=4px metric. Counts are not semantic correctness or certified SVG holes.",
  });
}
function pick(r) {
  return {
    mae: r.libvips.mae,
    chromiumMae: r.chromium.mae,
    iou: r.libvips.foregroundIoU,
    sourceMask: r.libvips.sourceMask,
    outputMask: r.libvips.outputMask,
    worst: r.libvips.worst,
    paths: r.complexity.paths,
    anchors: r.complexity.anchors,
    curves: r.complexity.curves,
    colors: r.complexity.colors,
    bytes: r.complexity.bytes,
    closed: r.complexity.closed,
    compoundPaths: r.complexity.compoundPaths,
    crossings: r.complexity.withinPathCrossings,
    crossingStatus: r.complexity.crossingStatus,
    inkscape: r.inkscape,
    runs: r.runs,
    boundary: r.boundary,
    svgSHA256: r.svgSHA256,
  };
}
const actualOriginalRepair = pairs.filter(
  (r) =>
    r.image.startsWith("original-") &&
    r.delta.holes > 0 &&
    r.delta.mae <= 0 &&
    r.delta.chromiumMae <= 0,
);
const unseen = pairs.filter(
  (r) =>
    ["stencil-kite", "ribbon-garden"].includes(r.family) &&
    !r.unchanged &&
    r.delta.mae < 0 &&
    r.delta.chromiumMae < 0,
);
const result = {
  status: failures.length ? "FAIL" : "PASS_INFRASTRUCTURE_ONLY",
  failures,
  images: ids.length,
  observerIdentical: pairs.filter(
    (r) => !failures.includes(r.image + " unconfigured observer changed SVG"),
  ).length,
  unchanged: pairs.filter((r) => r.unchanged).length,
  negativeControls: pairs.filter((r) => negatives.has(r.image)),
  actualOriginalRepair: actualOriginalRepair.map((r) => r.image),
  unseenReconstructionImprovements: unseen.map((r) => r.image),
  reconstructionRegressions: pairs
    .filter((r) => r.delta.mae > 0 || r.delta.chromiumMae > 0)
    .map((r) => ({ image: r.image, delta: r.delta })),
  pairs,
  promotion:
    "REQUIRES_SEPARATE_GEOMETRY_AND_HISTORICAL_GATES_AND_VISUAL_REVIEW; this is not a universal quality pass",
};
await writeFile(
  root + "/thin-feature-review.json",
  JSON.stringify(result, null, 2),
);
console.log({
  status: result.status,
  failures,
  images: ids.length,
  changed: pairs.filter((r) => !r.unchanged).length,
  actualOriginalRepair: result.actualOriginalRepair,
  unseen: result.unseenReconstructionImprovements,
});
if (failures.length) process.exitCode = 1;
