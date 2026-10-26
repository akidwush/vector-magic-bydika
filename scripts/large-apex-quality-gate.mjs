import { readFile, writeFile } from "node:fs/promises";
import { geometry } from "./curve-geometry-metrics.mjs";
const root = process.env.NEXORA_PROOF_DIR;
if (!root) throw Error("An isolated proof root is required");
const rows = JSON.parse(
  await readFile(root + "/large-apex/low-resolution/comparison.json"),
);
const failures = [];
const check = (ok, key, reason) => {
  if (!ok) failures.push({ key, reason });
};
check(rows.length === 45, "suite", "all 45 cases required");
const primary = "triangle-eight-native-srgb-128";
for (const r of rows) {
  const [b, c] = r.variants,
    k = r.key;
  check(b.autoHash === c.autoHash, k, "Auto changed");
  check(
    c.anchors <= b.anchors &&
      c.paths === b.paths &&
      c.structure.closed === b.structure.closed,
    k,
    "anchor/closure regression",
  );
  check(
    c.structure.properCrossings <= b.structure.properCrossings,
    k,
    "new crossings",
  );
  for (const m of ["mean", "p95", "max"])
    check(c.geometry[m] <= b.geometry[m] + 1e-6, k, "boundary " + m);
  for (const renderer of ["raster", "chromium"]) {
    check(c[renderer].mae <= b[renderer].mae + 1e-9, k, renderer + " RGBA");
    check(c[renderer].iou >= b[renderer].iou - 1e-9, k, renderer + " IoU");
  }
  check(
    c.cornerAccuracy.precision >= b.cornerAccuracy.precision &&
      c.cornerAccuracy.recall >= b.cornerAccuracy.recall,
    k,
    "corners",
  );
  const median = (v) => [v.ms, ...v.warmMs].sort((a, b) => a - b)[1];
  check(median(c) <= median(b) + 500, k, "added median CPU >500ms");
  if (k !== primary) {
    check(r.unchanged, k, "unrelated Stage 1.6E geometry changed");
    continue;
  }
  check(
    c.geometry.max < 2 &&
      c.geometry.max < b.geometry.max * 0.5 &&
      c.geometry.mean < b.geometry.mean * 0.8,
    k,
    "material absolute improvement",
  );
  check(
    c.cornerAccuracy.precision === 1 && c.cornerAccuracy.recall === 1,
    k,
    "true corners not recovered",
  );
  check(
    c.cornerAccuracy.endpointAnchorErrors[0] < 0.5 &&
      c.cornerAccuracy.endpointBoundaryErrors[0] < 0.5,
    k,
    "serialized apex accuracy",
  );
  check(c.structure.properCrossings === 0, k, "invalid new topology");
  const events = [];
  for (let i = 0; i < (c.largeApex?.length || 0); i += 48)
    events.push(c.largeApex.slice(i, i + 48));
  const local = events.find((e) => e[0] === 30),
    committed = events.find((e) => e[0] === 40);
  check(!!local && !!committed, k, "independent certification/commit missing");
  if (local && committed) {
    check(
      local[30] === 0 && committed[30] === 0,
      k,
      "extended correction mislabeled as legacy pass",
    );
    check(
      local[31] === 1 && local[32] === 1 && local[42] === 1,
      k,
      "extended geometry/whole wedge verification failed",
    );
    check(
      local[26] >= 3 && local[28] < local[27] * 0.75,
      k,
      "missing positive tip evidence",
    );
    check(
      local[21] < local[20] * 0.8 && local[23] < local[22],
      k,
      "local source coverage/RGB failed",
    );
    check(
      committed[21] < committed[20] && committed[23] < committed[22],
      k,
      "whole source reconstruction failed",
    );
    check(
      local[8] > 3.5 && local[33] > 3.5 && local[33] < local[9],
      k,
      "total original-to-final displacement not verified",
    );
    check(
      Math.abs(
        Math.hypot(local[4] - local[2], local[5] - local[3]) - local[8],
      ) < 1e-8,
      k,
      "baseline displacement mismatch",
    );
    check(local[41] < 250, k, "extended apex CPU >250ms");
    const g = geometry(
      await readFile(
        root + "/large-apex/low-resolution/exports/" + c.filename,
        "utf8",
      ),
    );
    const anchors = g.paths.flatMap((p) => p.edges.map((e) => e[0]));
    check(
      Math.min(
        ...anchors.map((p) => Math.hypot(p[0] - local[4], p[1] - local[5])),
      ) < 0.0001,
      k,
      "certified apex lost in serialization",
    );
    const e = c.apexEvidence;
    let final = false;
    for (let i = 0; i < e.length; i += 32)
      if (
        e[i] === 110 &&
        e[i + 16] === 0 &&
        [15, 17, 18, 19, 20, 21].every((j) => e[i + j] === 1)
      )
        final = true;
    check(final, k, "legacy/extended final topology audit mismatch");
  }
}
const result = {
  status: failures.length ? "FAIL" : "PASS",
  scope:
    "source-certified Triangle128 and byte-identical Stage1.6E retention; retained failures are not repairs",
  cases: rows.length,
  failures,
};
await writeFile(
  root + "/large-apex/quality-gate.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exitCode = 1;
