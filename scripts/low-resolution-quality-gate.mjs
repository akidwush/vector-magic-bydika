// New low-resolution requirements; the Stage 1.6B gate is run unchanged too.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve(
  process.env.NEXORA_PROOF_DIR || "benchmark-results/stage16c/browser-proof",
);
const rows = JSON.parse(
  await readFile(root + "/low-resolution/comparison.json"),
);
const failures = [],
  remaining = [],
  runtimeOutliers = [];
const median = (values) => [...values].sort((a, b) => a - b)[1];
const fail = (row, criterion, values) =>
  failures.push({ key: row.key, criterion, ...values });
const verified = {
  "cubic-1024": 0.766975618908304,
  "wave-1024": 0.6600000000000819,
  "wave-512": 0.5780881347656077,
};
if (rows.length !== 45)
  throw Error("Missing core/held-out resolution comparisons");
for (const row of rows) {
  const [b, c] = row.variants;
  if (b.autoHash !== c.autoHash) fail(row, "normal Auto control changed");
  if (
    c.anchors > b.anchors ||
    c.paths !== b.paths ||
    c.structure.closed !== b.structure.closed
  )
    fail(row, "node budget or closure changed");
  if (
    c.structure.properCrossings > b.structure.properCrossings ||
    (!row.unchanged && c.structure.properCrossings !== 0)
  )
    fail(row, "new or modified invalid topology");
  if (
    c.cornerAccuracy.precision < b.cornerAccuracy.precision - 1e-9 ||
    c.cornerAccuracy.recall < b.cornerAccuracy.recall - 1e-9 ||
    c.cornerAccuracy.unexpected > b.cornerAccuracy.unexpected
  )
    fail(row, "true corner lost or false G0 corner added");
  for (const renderer of ["raster", "chromium"]) {
    if (c[renderer].mae > b[renderer].mae + 1e-9)
      fail(row, renderer + " premultiplied RGBA regression");
    if (c[renderer].iou < b[renderer].iou - 1e-9)
      fail(row, renderer + " silhouette regression");
  }
  for (const k of ["mean", "p95", "max"])
    if (c.geometry[k] > b.geometry[k] + 1e-6)
      fail(row, "absolute " + k + " regression");
  if ((c.recovery[24] || 0) > 250)
    fail(row, "local initialization exceeds 250ms desktop research budget");
  // Compare three paired runs before reference/raster scoring. One wall-clock
  // stall in the unchanged legacy fitter is not a measurement of new solver
  // cost. Keep every raw run and expose outliers rather than discarding them.
  const before = [b.ms, ...b.warmMs],
    after = [c.ms, ...c.warmMs];
  if (before.length !== 3 || after.length !== 3)
    throw Error("Three paired runs required");
  const added = after.map((v, i) => v - before[i]);
  if (median(added) > 500 || median(after) > median(before) + 500)
    fail(row, "median added conversion exceeds 500ms", {
      baseline: before,
      candidate: after,
    });
  for (let i = 0; i < 3; i++)
    if (added[i] > 500)
      runtimeOutliers.push({
        key: row.key,
        run: i,
        baseline: before[i],
        candidate: after[i],
        medianAddedMs: median(added),
        initializationMs: c.recovery[24] || 0,
      });
  if (row.clipped || row.expectedUncertain)
    if (!row.unchanged) fail(row, "ambiguous or clipped input was modified");
  if (row.core && row.name === "cubic" && row.width < 1024) {
    for (const k of ["mean", "p95", "max"])
      if (c.geometry[k] > b.geometry[k] * 0.95)
        fail(row, "at least 5% Cubic " + k + " improvement required");
    if (
      c.geometry.max >= 2 ||
      Math.max(...c.cornerAccuracy.endpointAnchorErrors) >= 2
    )
      fail(row, "Cubic acute endpoint remains >=2px");
    if (c.cornerAccuracy.recall !== 1)
      fail(row, "Cubic acute G0 corner missing");
  }
  if (row.core && row.name === "wave" && row.width === 128) {
    if (
      c.geometry.mean > b.geometry.mean * 0.95 ||
      c.geometry.max > b.geometry.max * 0.95
    )
      fail(row, "material Wave 128 mean/maximum improvement required");
    if (
      Math.max(...c.cornerAccuracy.endpointAnchorErrors) >= 1.2 ||
      c.cornerAccuracy.recall !== 1
    )
      fail(row, "Wave 128 critical corner not recovered");
    if (c.geometry.p95 > b.geometry.p95 * 0.95)
      remaining.push({
        key: row.key,
        target: "5% p95 improvement",
        status: "NOT ACHIEVED",
        baseline: b.geometry.p95,
        candidate: c.geometry.p95,
      });
  }
  if (row.core && verified[row.key] !== undefined) {
    if (Math.abs(b.geometry.max - verified[row.key]) > 1e-6)
      fail(row, "verified Stage 1.6B baseline mismatch");
    if (!row.unchanged || c.geometry.max > verified[row.key] + 1e-6)
      fail(row, "Stage 1.6B protected export changed");
  }
  if (row.expectedUncertain || row.clipped || b.structure.properCrossings)
    remaining.push({
      key: row.key,
      status: "BASELINE RETAINED; not a quality PASS",
      boundaryMax: c.geometry.max,
      crossings: c.structure.properCrossings,
    });
}
const result = {
  status: failures.length ? "FAIL" : "PASS",
  scope:
    "Cubic 128/512 acute recovery, Wave 128 corner and maximum recovery, protected exports and held-out nonregression",
  cases: rows.length,
  runtimePolicy:
    "500ms added budget on three paired-run medians; 250ms local initialization budget; all raw cold/warm runs retained",
  runtimeOutliers,
  failures,
  remaining,
};
await writeFile(
  root + "/low-resolution/quality-gate.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exitCode = 1;
