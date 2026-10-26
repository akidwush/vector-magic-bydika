// Attribute marks to OS threads. GC/compile intervals overlap: report their union,
// never sum nested V8 timers. CPU snapshots envelope the call, not just its marks.
import { createReadStream } from "node:fs";
import { readFile as read, writeFile as write, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { distribution } from "./runtime-statistics.mjs";
const root = resolve(process.env.NEXORA_CROSS_ROOT);
const output = process.env.NEXORA_CROSS_ANALYSIS_ROOT
  ? resolve(process.env.NEXORA_CROSS_ANALYSIS_ROOT)
  : root;
if (output !== root) await mkdir(output);
const rows = JSON.parse(await read(root + "/observations.json"));
const env = JSON.parse(await read(root + "/environment.json"));
const threadEvents = new Map(),
  marks = new Map(),
  eventNames = new Map();
for (let rep = 0; rep < env.repetitions; rep++) {
  if (
    env.tracePattern?.[rep] === "off" ||
    (!env.tracePattern && !env.traceEnabled)
  )
    continue;
  const lines = createInterface({
    input: createReadStream(root + `/traces/session-${rep}.jsonl`),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    const e = JSON.parse(line);
    const name = e.name || "";
    if (name.startsWith("nexora-core-"))
      marks.set(name, { rep, pid: e.pid, tid: e.tid, ts: e.ts });
    if (
      e.ph === "X" &&
      e.dur > 0 &&
      /wasm|compile|MinorGC|MajorGC/i.test(name)
    ) {
      const key = rep + ":" + e.pid + ":" + e.tid;
      if (!threadEvents.has(key)) threadEvents.set(key, []);
      threadEvents
        .get(key)
        .push({ name, start: e.ts, end: e.ts + e.dur, args: e.args });
      eventNames.set(name, (eventNames.get(name) || 0) + 1);
    }
  }
}
function union(events, start, end) {
  const intervals = events
    .map((e) => [Math.max(start, e.start), Math.min(end, e.end)])
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  let total = 0,
    lo = 0,
    hi = 0;
  for (const [a, b] of intervals) {
    if (a > hi) {
      total += hi - lo;
      lo = a;
      hi = b;
    } else hi = Math.max(hi, b);
  }
  return (total + hi - lo) / 1000;
}
function cgroup(text) {
  return Object.fromEntries(
    (text || "")
      .trim()
      .split("\n")
      .map((s) => s.split(/\s+/))
      .map(([k, v]) => [k, Number(v)]),
  );
}
// CPU-profiler weights use sampled wall intervals, not hardware CPU cycles.
// Restrict to the same marked binding window; kernel CPU remains independent.
function sampleStacks(profile, start, end) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const parents = new Map();
  for (const n of profile.nodes)
    for (const child of n.children ?? []) parents.set(child, n.id);
  let at = profile.startTime,
    count = 0;
  const self = new Map(),
    inclusive = new Map();
  for (let i = 0; i < (profile.samples?.length ?? 0); i++) {
    const dt = profile.timeDeltas[i];
    at += dt;
    const weight = Math.max(0, Math.min(at, end) - Math.max(at - dt, start));
    if (!weight) continue;
    count++;
    const id = profile.samples[i];
    self.set(id, (self.get(id) ?? 0) + weight);
    let parent = id,
      limit = 0;
    while (parent != null && limit++ < 256) {
      inclusive.set(parent, (inclusive.get(parent) ?? 0) + weight);
      parent = parents.get(parent);
    }
  }
  const top = (values) =>
    [...values]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([id, us]) => ({
        id,
        frame: nodes.get(id)?.callFrame,
        weightedWallMs: us / 1000,
      }));
  return {
    inCoreSamples: count,
    windowMs: (end - start) / 1000,
    self: top(self),
    inclusive: top(inclusive),
    policy:
      "Sampling weights, not exclusive CPU counters; inline frames may obscure individual Rust functions. Kernel scheduling data is separate.",
  };
}
const missing = [];
for (const r of rows) {
  if (r.traceEnabled === false) {
    r.attribution = null;
    continue;
  }
  const a = marks.get("nexora-core-start-" + r.markId),
    b = marks.get("nexora-core-end-" + r.markId);
  if (!a || !b) {
    missing.push(r.traceId);
    continue;
  }
  if (r.cpuProfilePath)
    r.cpuSamples = sampleStacks(
      JSON.parse(await read(root + "/" + r.cpuProfilePath)),
      a.ts,
      b.ts,
    );
  const id = a.pid + ":" + a.tid,
    events = (threadEvents.get(r.rep + ":" + id) || []).filter(
      (e) => e.end > a.ts && e.start < b.ts,
    );
  const execution = r.cpu.find((t) => t.id === id) ?? null;
  const cpu = r.cpu.filter((t) => t.id !== id);
  const bgEvents = [...threadEvents]
    .filter(([key]) => key.startsWith(r.rep + ":") && key !== r.rep + ":" + id)
    .flatMap(([, es]) => es)
    .filter((e) => e.end > a.ts && e.start < b.ts);
  const before = cgroup(r.systemBefore.cgroup),
    after = cgroup(r.systemAfter.cgroup);
  r.attribution = {
    executionThread: id,
    execution,
    traceMarkMs: (b.ts - a.ts) / 1000,
    gcUnionMs: union(
      events.filter((e) => ["MinorGC", "MajorGC"].includes(e.name)),
      a.ts,
      b.ts,
    ),
    compileUnionMs: union(
      events.filter((e) => /compile/i.test(e.name)),
      a.ts,
      b.ts,
    ),
    wasmEventUnionMs: union(
      events.filter((e) => /wasm/i.test(e.name)),
      a.ts,
      b.ts,
    ),
    eventNames: [...new Set(events.map((e) => e.name))],
    backgroundCompileEvents: bgEvents.filter((e) => /compile/i.test(e.name))
      .length,
    backgroundInternalCompileEvents: bgEvents.filter(
      (e) =>
        /compile/i.test(e.name) && JSON.stringify(e.args).includes("chrome://"),
    ).length,
    otherRendererMainCPU: cpu
      .filter(
        (t) =>
          t.processType === "renderer" &&
          t.id.split(":")[0] === t.id.split(":")[1],
      )
      .reduce((s, t) => s + t.cpuMs, 0),
    otherThreadCPU: cpu.reduce((s, t) => s + t.cpuMs, 0),
    cgroupThrottledMs:
      after.throttled_usec == null
        ? null
        : (after.throttled_usec - before.throttled_usec) / 1000,
    caveat:
      "OS CPU/runqueue snapshots include harness/getters/message overhead and are not exclusive Rust CPU. Cgroup counters cover shared quota. V8 compileModule is not evidence of WASM tiering.",
  };
  delete r.systemBefore;
  delete r.systemAfter;
}
const groups = [];
for (const fixture of new Set(rows.map((r) => r.fixture)))
  for (const build of new Set(rows.map((r) => r.buildId)))
    for (const mode of env.modes)
      for (const state of ["first", "warm", "reset"])
        for (const tracing of env.tracePattern
          ? [true, false]
          : [env.traceEnabled]) {
          const rs = rows.filter(
            (r) =>
              r.fixture === fixture &&
              r.buildId === build &&
              r.mode === mode &&
              r.state === state &&
              (r.traceEnabled ?? env.traceEnabled) === tracing,
          );
          const dist = (fn) => distribution(rs.map(fn).filter(Number.isFinite));
          const sessions = Array.from({ length: env.repetitions }, (_, rep) => {
            const slots = [0, 1].map((slot) =>
              distribution(
                rs
                  .filter((r) => r.rep === rep && r.slot === slot)
                  .map((r) => r.coreMs),
              ),
            );
            return {
              rep,
              slots,
              aaMedianDifferenceMs: slots.every(Boolean)
                ? slots[1].median - slots[0].median
                : null,
            };
          });
          groups.push({
            fixture,
            build,
            mode,
            state,
            tracing,
            core: dist((r) => r.coreMs),
            rust: dist((r) => r.runtime?.[32]),
            cpu: dist((r) => r.attribution?.execution?.cpuMs),
            runqueue: dist((r) => r.attribution?.execution?.runqueueMs),
            gc: dist((r) => r.attribution?.gcUnionMs),
            compile: dist((r) => r.attribution?.compileUnionMs),
            otherCPU: dist((r) => r.attribution?.otherThreadCPU),
            wall: dist((r) => r.resultWallMs),
            page: dist((r) => r.pageResultMs ?? r.appResultReadyMs),
            memory: dist((r) => r.memory),
            sessions,
          });
        }
await write(output + "/attribution.json", JSON.stringify(rows), { flag: "wx" });
await write(
  output + "/attribution-summary.json",
  JSON.stringify(
    {
      missing,
      eventNames: [...eventNames],
      groups,
      slowest: rows
        .toSorted((a, b) => b.coreMs - a.coreMs)
        .slice(0, 20)
        .map(({ traceId, coreMs, stages, attribution, cpuSamples }) => ({
          traceId,
          coreMs,
          stages,
          attribution,
          cpuSamples,
        })),
    },
    null,
    2,
  ),
);
await write(
  output + "/analysis-metadata.json",
  JSON.stringify(
    {
      schema: 3,
      inputRoot: root,
      analysisSHA256: createHash("sha256")
        .update(await read(new URL(import.meta.url)))
        .digest("hex"),
      policy:
        "Renderer main thread identified by PID=TID, independent of Linux comm; raw observations and previous analyses untouched.",
    },
    null,
    2,
  ),
  { flag: "wx" },
);
console.log(
  JSON.stringify({
    rows: rows.length,
    missing: missing.length,
    eventNames: [...eventNames],
  }),
);
if (missing.length) process.exitCode = 1;
