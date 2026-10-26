// Stage 1.6D is additional to the unchanged Stage 1.5/B/C gates.
import { readFile, writeFile } from "node:fs/promises";
const root = process.env.NEXORA_PROOF_DIR;
if (!root) throw Error("An isolated proof root is required");
const rows = JSON.parse(
  await readFile(root + "/false-corner/low-resolution/comparison.json"),
);
const failures = [];
const check = (ok, key, reason) => {
  if (!ok) failures.push({ key, reason });
};
check(rows.length === 45, "suite", "all 45 cases required");
const protectedKeys = [
  "cubic-128",
  "cubic-512",
  "cubic-1024",
  "wave-512",
  "wave-1024",
];
for (const row of rows) {
  const [b, c] = row.variants,
    k = row.key;
  check(b.autoHash === c.autoHash, k, "normal Auto changed");
  check(
    c.anchors <= b.anchors &&
      c.paths === b.paths &&
      c.structure.closed === b.structure.closed,
    k,
    "node/closure regression",
  );
  check(
    c.structure.properCrossings <= b.structure.properCrossings,
    k,
    "new crossings",
  );
  for (const metric of ["mean", "p95", "max"])
    check(
      c.geometry[metric] <= b.geometry[metric] + 1e-6,
      k,
      "boundary " + metric,
    );
  check(
    c.cornerAccuracy.recall >= b.cornerAccuracy.recall &&
      c.cornerAccuracy.precision >= b.cornerAccuracy.precision,
    k,
    "corner accuracy",
  );
  check(
    c.cornerAccuracy.unexpected <= b.cornerAccuracy.unexpected,
    k,
    "false corner added",
  );
  for (const renderer of ["raster", "chromium"]) {
    check(c[renderer].mae <= b[renderer].mae + 1e-9, k, renderer + " RGBA");
    check(
      c[renderer].iou >= b[renderer].iou - 1e-9,
      k,
      renderer + " silhouette",
    );
  }
  if (protectedKeys.includes(k))
    check(row.unchanged, k, "protected Stage 1.6C export changed");
  const med = (v) => [v.ms, ...v.warmMs].sort((a, b) => a - b)[1];
  check(
    med(c) <= med(b) + 500,
    k,
    "added median CPU exceeds existing 500ms budget",
  );
  check(
    (c.recovery[31] || 0) < 250,
    k,
    "continuity exceeds 250ms research budget",
  );
  if (!row.unchanged)
    check(c.structure.properCrossings === 0, k, "modified invalid baseline");
  if (k === "wave-128") {
    check(b.cornerAccuracy.unexpected === 8, k, "verified baseline mismatch");
    check(
      c.cornerAccuracy.unexpected <= 2 && c.cornerAccuracy.recall === 1,
      k,
      "false G0 suppression insufficient",
    );
    check(
      c.geometry.mean < b.geometry.mean * 0.8 &&
        c.geometry.p95 < b.geometry.p95 * 0.8 &&
        c.geometry.max < b.geometry.max * 0.8,
      k,
      "material geometry improvement required",
    );
    const d = c.continuity;
    check(d?.[1] >= 3, k, "source-verified paired corrections missing");
    for (let i = 3; i < d.length; i += 16)
      if (d[i + 2] === 2) {
        check(
          d[i + 7] < d[i + 6] * 0.85 && d[i + 9] < d[i + 8],
          k,
          "local coverage/RGB loss did not improve",
        );
      }
  }
}
const result = {
  status: failures.length ? "FAIL" : "PASS",
  cases: rows.length,
  failures,
  scope:
    "Wave false corners/valleys and Stage 1.6C retention; unchanged invalid held-outs remain unresolved",
};
await writeFile(
  root + "/false-corner/quality-gate.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exitCode = 1;
