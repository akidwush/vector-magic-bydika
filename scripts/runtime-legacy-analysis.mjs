// Independent attribution derived from immutable per-call recordings.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const root = resolve(process.env.NEXORA_LEGACY_ROOT);
const rows = (await readFile(root + "/observations.jsonl", "utf8"))
  .trim()
  .split("\n")
  .map(JSON.parse);
const hash = (v) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const median = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
const dist = (v) => ({
  n: v.length,
  median: median(v),
  min: Math.min(...v),
  max: Math.max(...v),
  p95: [...v].sort((a, b) => a - b)[Math.ceil(v.length * 0.95) - 1],
});
function families(p, start, end) {
  const nodes = new Map(p.nodes.map((n) => [n.id, n])),
    parents = new Map();
  for (const n of p.nodes)
    for (const c of n.children ?? []) parents.set(c, n.id);
  let at = p.startTime;
  const values = {};
  for (let i = 0; i < p.samples.length; i++) {
    const dt = p.timeDeltas[i];
    at += dt;
    const us = Math.max(0, Math.min(at, end) - Math.max(at - dt, start));
    if (!us) continue;
    let id = p.samples[i],
      family = "other";
    for (
      let depth = 0;
      id != null && depth < 256;
      depth++, id = parents.get(id)
    ) {
      const name = nodes.get(id)?.callFrame?.functionName ?? "";
      // First matching frame from leaf to root; each sample counted exactly once.
      const rules = [
        [
          "binary_components",
          /BinaryImage.*to_clusters|::clusters::Cluster.*(?:add|to_binary_image)/,
        ],
        ["color_clustering", /::color_clusters::/],
        ["source_contour", /source_fit::raw_segment/],
        ["source_samples", /source_fit::samples_mask/],
        ["inverse_fitting", /::inverse::/],
        ["recovery", /::recovery::/],
        ["corner_detection", /::corners::/],
        ["geometry_validation", /::planar::/],
        ["writer", /svg.*write|svg_writer/],
        ["gc", /^\(garbage collector\)$/],
      ];
      const hit = rules.find(([, r]) => r.test(name));
      if (hit) {
        family = hit[0];
        break;
      }
    }
    values[family] = (values[family] ?? 0) + us / 1000;
  }
  return values;
}
const calls = [],
  signatures = new Map();
for (const row of rows) {
  const profile =
    row.condition === "profiled"
      ? JSON.parse(await readFile(root + "/" + row.id + "-profile.json"))
      : null;
  const task =
    row.condition === "profiled"
      ? JSON.parse(await readFile(root + "/" + row.id + "-task.json"))
      : null;
  for (const c of row.calls) {
    let work = null;
    if (c.legacyWork) {
      work = {
        runtime: c.runtime.slice(0, 32),
        inverse: c.inverseWork.slice(0, 16),
        legacy: c.legacyWork,
      };
      const k = row.input.key + "/" + c.key;
      const signaturesFor = signatures.get(k) ?? new Map();
      const h = hash(work);
      signaturesFor.set(h, {
        hash: h,
        work,
        examples: [...(signaturesFor.get(h)?.examples ?? []), c.id],
      });
      signatures.set(k, signaturesFor);
    }
    const s = c.markers?.start.ts,
      e = c.markers?.end.ts;
    let contextSwitches = null;
    if (task) {
      const pre = task.samples.filter((r) => r.hiUs <= s).at(-1),
        post = task.samples.find((r) => r.loUs >= e);
      const a = pre?.hardware.context_switches,
        b = post?.hardware.context_switches;
      if (Array.isArray(a) && Array.isArray(b))
        contextSwitches = {
          upperBracketRawValue: b[0] - a[0],
          timeEnabledNs: b[1] - a[1],
          timeRunningNs: b[2] - a[2],
        };
    }
    calls.push({
      ...c,
      group: row.id,
      session: row.session,
      fixture: row.input.key,
      condition: row.condition,
      workSHA256: work ? hash(work) : null,
      families: profile ? families(profile, s, e) : null,
      contextSwitches,
    });
  }
}
const paired = [];
for (const f of new Set(rows.map((r) => r.input.key)))
  for (const session of new Set(rows.map((r) => r.session))) {
    const groups = rows.filter(
      (r) => r.input.key === f && r.session === session,
    );
    for (const key of Object.keys(groups[0]?.outputs ?? {})) {
      const values = {};
      for (const g of groups)
        values[g.condition] = dist(
          g.calls.filter((c) => c.key === key).map((c) => c.coreMs),
        );
      paired.push({
        fixture: f,
        session,
        key,
        ...values,
        profiledMinusControlMs:
          values.control && values.profiled
            ? values.profiled.median - values.control.median
            : null,
      });
    }
  }
const result = {
  calls,
  distributions: [
    ...new Set(calls.map((c) => c.fixture + "/" + c.key + "/" + c.condition)),
  ].map((key) => ({
    key,
    ...dist(
      calls
        .filter((c) => c.fixture + "/" + c.key + "/" + c.condition === key)
        .map((c) => c.coreMs),
    ),
  })),
  sessionPairs: paired,
  workSignatures: [...signatures].map(([key, v]) => ({
    key,
    distinctSignatures: v.size,
    signatures: [...v.values()],
  })),
  samplingObserverCPU: dist(
    rows.filter((r) => r.observerCpuMs != null).map((r) => r.observerCpuMs),
  ),
  severe: calls.filter((c) => c.coreMs >= 2000),
  policy:
    "Inclusive stage timers overlap. Family sample weights partition sampled wall intervals, not hardware instructions/CPU cycles. Work signatures cover instrumented operations only, never private Visioncortex loop counts. A signature match does not establish equal instruction count.",
};
await writeFile(root + "/analysis.json", JSON.stringify(result, null, 2));
console.log(
  JSON.stringify(
    {
      calls: calls.length,
      severe: result.severe.map((c) => [c.id, c.coreMs]),
      signatures: result.workSignatures.map((s) => [
        s.key,
        s.distinctSignatures,
      ]),
    },
    null,
    2,
  ),
);
