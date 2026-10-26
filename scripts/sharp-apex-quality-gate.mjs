import { readFile, writeFile } from "node:fs/promises";
import { geometry } from "./curve-geometry-metrics.mjs";
const root = process.env.NEXORA_PROOF_DIR;
if (!root) throw Error("An isolated proof root is required");
const rows = JSON.parse(
  await readFile(root + "/sharp-apex/low-resolution/comparison.json"),
);
const failures = [];
const check = (ok, key, reason) => {
  if (!ok) failures.push({ key, reason });
};
check(rows.length === 45, "suite", "all 45 comparisons required");
const protectedKeys = [
  "wave-128",
  "wave-512",
  "wave-1024",
  "cubic-128",
  "cubic-512",
  "cubic-1024",
  "triangle-eight-native-srgb-1024",
];
for (const r of rows) {
  const [b, c] = r.variants,
    k = r.key;
  check(b.autoHash === c.autoHash, k, "Auto changed");
  check(
    c.anchors <= b.anchors &&
      c.paths === b.paths &&
      c.structure.closed === b.structure.closed,
    k,
    "nodes/closure",
  );
  check(
    c.structure.properCrossings <= b.structure.properCrossings,
    k,
    "new crossings",
  );
  if (!r.unchanged)
    check(c.structure.properCrossings === 0, k, "modified invalid topology");
  for (const m of ["mean", "p95", "max"])
    check(c.geometry[m] <= b.geometry[m] + 1e-6, k, "geometry " + m);
  for (const renderer of ["raster", "chromium"]) {
    check(c[renderer].mae <= b[renderer].mae + 1e-9, k, renderer + " RGBA");
    check(c[renderer].iou >= b[renderer].iou - 1e-9, k, renderer + " IoU");
  }
  check(
    c.cornerAccuracy.recall >= b.cornerAccuracy.recall &&
      c.cornerAccuracy.precision >= b.cornerAccuracy.precision,
    k,
    "corners",
  );
  if (protectedKeys.includes(k))
    check(r.unchanged, k, "protected Stage 1.6D bytes changed");
  const median = (v) => [v.ms, ...v.warmMs].sort((a, b) => a - b)[1];
  check(median(c) <= median(b) + 500, k, "added median CPU >500ms");
  check((c.recovery[34] || 0) < 250, k, "apex CPU >250ms");
  if (k === "triangle-eight-native-srgb-512") {
    check(
      c.geometry.max < b.geometry.max * 0.8 &&
        c.geometry.p95 < b.geometry.p95 * 0.8,
      k,
      "material 512 improvement",
    );
    check(
      Math.max(...c.cornerAccuracy.endpointAnchorErrors) <
        Math.max(...b.cornerAccuracy.endpointAnchorErrors),
      k,
      "final anchor accuracy",
    );
    const e = c.apexEvidence;
    check(e?.length > 0, k, "diagnostics missing");
    let proved = false;
    for (let i = 0; i < e.length; i += 32)
      if (
        e[i] === 5 &&
        e[i + 12] < e[i + 11] * 0.85 &&
        e[i + 14] < e[i + 13] &&
        e[i + 15] === 1 &&
        e[i + 16] === 1
      )
        proved = true;
    check(proved, k, "source-verified joint reconstruction missing");
    const final = geometry(
      await readFile(
        root + "/sharp-apex/low-resolution/exports/" + c.filename,
        "utf8",
      ),
    );
    const anchors = final.paths.flatMap((p) => p.edges.map((e) => e[0]));
    let serialized = false;
    for (let i = 0; i < e.length; i += 32)
      if (e[i] === 110) {
        const distance = Math.min(
          ...anchors.map((p) => Math.hypot(p[0] - e[i + 4], p[1] - e[i + 5])),
        );
        if (
          distance < 1e-6 &&
          e[i + 17] === 1 &&
          e[i + 18] === 1 &&
          e[i + 19] === 1 &&
          e[i + 20] === 1 &&
          e[i + 21] === 1
        )
          serialized = true;
      }
    check(
      serialized,
      k,
      "committed source vertex did not survive serialization/topology",
    );
  }
  if (k === "triangle-eight-native-srgb-128")
    check(r.unchanged, k, "uncertified >3px correction applied");
}
const result = {
  status: failures.length ? "FAIL" : "PASS",
  scope: "512 already-G0 recovery and 1.6D retention; 128 remains unresolved",
  cases: rows.length,
  failures,
};
await writeFile(
  root + "/sharp-apex/quality-gate.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exitCode = 1;
