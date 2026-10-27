// Stage J: exact historical callback control, bounded sampled twin. No app mutation.
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cpus, release } from "node:os";
import { chromium } from "@playwright/test";
import sharp from "sharp";
import assert from "node:assert/strict";
import { callbacks, cpuBounds } from "./runtime-legacy-protocol.mjs";
import { optional, snapshot, deltaCPU } from "./runtime-cross-system.mjs";
const root = resolve(
  process.env.NEXORA_LEGACY_ROOT ??
    "benchmark-results/stage16j/legacy-" +
      new Date().toISOString().replaceAll(/[:.]/g, "-"),
);
await mkdir(root, { recursive: false });
await mkdir(root + "/exports");
const builds = resolve(
  process.env.NEXORA_CROSS_BUILDS ??
    "benchmark-results/stage16i/modules-20261026T153847",
);
const keys = (process.env.NEXORA_LEGACY_MODULES ?? "stage16f,stage16h").split(
  ",",
);
assert.equal(keys.length, 2);
const sessions = Number(process.env.NEXORA_LEGACY_SESSIONS ?? 3),
  detail = process.env.NEXORA_LEGACY_DETAIL === "1";
assert(Number.isInteger(sessions) && sessions >= 1 && sessions <= 3);
const fixtures = [
  ["wave-1024", "curve-optimization/wave-1024"],
  ["oblique-512", "acute-geometry/blade-oblique-native-srgb-512"],
  ["rounded-1024", "acute-geometry/rounded-blade-native-srgb-1024"],
  ["thin-ellipse-1024", "acute-geometry/thin-ellipse-native-srgb-1024"],
  ["triangle-512", "acute-geometry/triangle-eight-native-srgb-512"],
].filter(
  ([k]) =>
    !process.env.NEXORA_LEGACY_FIXTURES ||
    process.env.NEXORA_LEGACY_FIXTURES.split(",").includes(k),
);
assert(fixtures.length);
const hash = (b) => createHash("sha256").update(b).digest("hex");
const historical = await readFile(
  "scripts/low-resolution-benchmark.mjs",
  "utf8",
);
const { original, marked, originalSource, markedSource } =
  callbacks(historical);
await writeFile(root + "/historical-callback.js", originalSource);
await writeFile(root + "/marked-callback.js", markedSource);
const manifests = {},
  files = {};
for (const key of keys) {
  const dir = builds + "/" + key;
  const m = JSON.parse(await readFile(dir + "/manifest.json"));
  files[key] = {};
  for (const f of ["nexora_wasm.js", "nexora_wasm_bg.wasm"])
    files[key][f] = await readFile(dir + "/" + f);
  assert.equal(hash(files[key]["nexora_wasm_bg.wasm"]), m.wasmSHA256);
  manifests[key] = { ...m, glueSHA256: hash(files[key]["nexora_wasm.js"]) };
}
const inputs = [];
for (const [key, path] of fixtures) {
  const png = await readFile("tests/fixtures/" + path + ".png");
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  inputs.push({
    key,
    path,
    pngSHA256: hash(png),
    rgbaSHA256: hash(data),
    w: info.width,
    h: info.height,
    bytes: data.toString("base64"),
  });
}
const plan = {
  schema: 1,
  created: new Date().toISOString(),
  sessions,
  jsFlags: process.env.NEXORA_LEGACY_JS_FLAGS ?? null,
  conditions: detail ? ["profiled"] : ["control", "profiled"],
  fixtures: inputs.map(({ bytes, ...r }) => r),
  keys,
  manifests,
  callbackSHA256: hash(originalSource),
  historicalSHA256: hash(historical),
  sequence: [
    keys[0],
    keys[1],
    keys[1],
    keys[0],
    keys[0],
    keys[1],
    keys[0] + " Auto",
    keys[1] + " Auto",
  ],
  severeThresholdMs: 2000,
  detail,
  policy:
    "Predeclared bounded sessions, no retries. Exact original callback in control. Marked twin adds no engine calls, yields or changed options. CPU bounds include marker bookkeeping outside original binding timer. Profiling weights are sampled wall time, not CPU cycles. No exclusive CPU guarantee.",
};
await writeFile(root + "/plan.json", JSON.stringify(plan, null, 2));
await writeFile(
  root + "/environment.json",
  JSON.stringify(
    {
      node: process.version,
      kernel: release(),
      cpu: cpus()[0]?.model,
      cores: cpus().length,
      quota: await optional("/sys/fs/cgroup/cpu.max"),
      procStatus: await optional("/proc/self/status"),
      meminfo: await optional("/proc/meminfo"),
      pressure: await optional("/sys/fs/cgroup/cpu.pressure"),
      frequency: await optional(
        "/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq",
      ),
      tools: await optional("/etc/os-release"),
    },
    null,
    2,
  ),
);
const server = createServer((req, res) => {
  if (req.url === "/") {
    res.end("<body></body>");
    return;
  }
  const [, key, file] = req.url.split("/");
  if (!files[key]?.[file]) {
    res.writeHead(404).end();
    return;
  }
  res.setHeader(
    "Content-Type",
    file.endsWith(".wasm") ? "application/wasm" : "text/javascript",
  );
  res.end(files[key][file]);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = "http://127.0.0.1:" + server.address().port;
async function traceStart(cdp) {
  const events = [];
  const handle = (e) => events.push(...e.value);
  cdp.on("Tracing.dataCollected", handle);
  await cdp.send("Tracing.start", {
    categories:
      "v8,disabled-by-default-v8.wasm,disabled-by-default-v8.gc,devtools.timeline,blink.user_timing",
    transferMode: "ReportEvents",
  });
  return async () => {
    const done = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
    await cdp.send("Tracing.end");
    await done;
    cdp.off("Tracing.dataCollected", handle);
    return events;
  };
}
function stacks(profile, start, end) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n])),
    parents = new Map();
  for (const n of profile.nodes)
    for (const c of n.children ?? []) parents.set(c, n.id);
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
    let id = profile.samples[i];
    self.set(id, (self.get(id) ?? 0) + weight);
    for (let k = 0; id != null && k < 256; k++, id = parents.get(id))
      inclusive.set(id, (inclusive.get(id) ?? 0) + weight);
  }
  const top = (v) =>
    [...v]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([id, us]) => ({
        frame: nodes.get(id)?.callFrame,
        weightedWallMs: us / 1000,
      }));
  return {
    samples: count,
    self: top(self),
    inclusive: top(inclusive),
    policy:
      "Sampled wall-interval weights; not exclusive CPU or hardware counters.",
  };
}
const all = [];
try {
  for (let session = 0; session < sessions; session++) {
    const browser = await chromium.launch({
      executablePath: process.env.NEXORA_CHROMIUM_PATH,
      args: process.env.NEXORA_LEGACY_JS_FLAGS
        ? ["--js-flags=" + process.env.NEXORA_LEGACY_JS_FLAGS]
        : [],
    });
    const cdp = await browser.newBrowserCDPSession();
    await writeFile(
      root + `/browser-${session}.json`,
      JSON.stringify({
        version: browser.version(),
        processInfo: (await cdp.send("SystemInfo.getProcessInfo")).processInfo,
      }),
    );
    try {
      const ordered = session % 2 ? [...inputs].reverse() : inputs;
      for (let fi = 0; fi < ordered.length; fi++) {
        const input = ordered[fi];
        const conditions = detail
          ? ["profiled"]
          : (session + fi) % 2
            ? ["profiled", "control"]
            : ["control", "profiled"];
        for (const condition of conditions) {
          const id = `s${session}-${input.key}-${condition}`;
          const page = await browser.newPage({ acceptDownloads: true });
          await page.goto(origin);
          const pc = await page.context().newCDPSession(page);
          let stopTrace,
            sampler,
            profile,
            task,
            clockValid = false,
            events = [],
            osData = null;
          try {
            if (condition === "profiled") {
              const endReady = await traceStart(cdp);
              const lo = Number(process.hrtime.bigint()) / 1000;
              await page.evaluate(
                (id) => performance.mark("legacy-ready-" + id),
                id,
              );
              const hi = Number(process.hrtime.bigint()) / 1000;
              const readyEvents = await endReady();
              const e = readyEvents.find(
                (e) => e.name === "legacy-ready-" + id,
              );
              assert(e, "Execution-thread mark missing");
              clockValid = e.ts >= lo - 1000 && e.ts <= hi + 1000;
              assert(clockValid, "CDP and kernel monotonic clock mismatch");
              task = {
                pid: e.pid,
                tid: e.tid,
                clockBracket: [lo, hi],
                mark: e,
              };
              stopTrace = await traceStart(cdp);
              await pc.send("Profiler.enable");
              await pc.send("Profiler.setSamplingInterval", { interval: 1000 });
              sampler = spawn(
                "python3",
                [
                  "scripts/runtime-thread-sampler.py",
                  "--pid",
                  String(e.pid),
                  "--tid",
                  String(e.tid),
                  "--output",
                  root + "/" + id + "-task.json",
                  "--seconds",
                  "120",
                ],
                { stdio: ["pipe", "pipe", "pipe"] },
              );
              let err = "";
              sampler.stderr.on("data", (b) => (err += b));
              await new Promise((r, j) => {
                let out = "";
                sampler.stdout.on("data", (b) => {
                  out += b;
                  if (out.includes("\n")) r();
                });
                sampler.once("exit", (code) =>
                  j(Error("Sampler exited " + code + ":" + err)),
                );
              });
              await pc.send("Profiler.start");
            }
            const before = await snapshot(cdp);
            const wallStart = performance.now();
            const result = await page.evaluate(
              condition === "control" ? original : marked,
              {
                keys,
                bytes: input.bytes,
                w: input.w,
                h: input.h,
                diagnosticId: id,
                detail,
              },
            );
            const callbackMs = performance.now() - wallStart;
            const after = await snapshot(cdp);
            if (condition === "profiled") {
              profile = (await pc.send("Profiler.stop")).profile;
              await writeFile(
                root + "/" + id + "-profile.json",
                JSON.stringify(profile),
              );
              sampler.stdin.end("\n");
              const code = await new Promise((r) => sampler.once("close", r));
              assert.equal(code, 0);
              sampler = null;
              events = await stopTrace();
              stopTrace = null;
              await writeFile(
                root + "/" + id + "-trace.json",
                JSON.stringify({ traceEvents: events }),
              );
              osData = JSON.parse(
                await readFile(root + "/" + id + "-task.json"),
              );
            }
            const outputs = condition === "control" ? result : result.outputs;
            const calls =
              condition === "control"
                ? keys.flatMap((key) =>
                    [outputs[key].ms, ...outputs[key].warmMs].map(
                      (coreMs, round) => ({
                        id: id + "-" + round + "-" + key,
                        key,
                        round,
                        coreMs,
                        stages: round
                          ? outputs[key].warmStages[round - 1]
                          : outputs[key].stages,
                      }),
                    ),
                  )
                : result.calls;
            for (const call of calls) {
              const start = events.find(
                  (e) => e.name === "nexora-legacy-start-" + call.id,
                ),
                end = events.find(
                  (e) => e.name === "nexora-legacy-end-" + call.id,
                );
              if (condition === "profiled") {
                assert(start && end);
                assert(start.pid === task.pid && start.tid === task.tid);
                call.markers = { start, end };
                call.cpu = cpuBounds(osData.samples, start.ts, end.ts);
                call.stacks = stacks(profile, start.ts, end.ts);
              }
              call.svgSHA256 = hash(outputs[call.key].svg);
            }
            for (const key of keys) {
              const result = outputs[key];
              for (const mode of ["svg", "autoSvg"]) {
                const filename = id + "-" + key + "-" + mode + ".svg";
                const download = page.waitForEvent("download");
                await page.evaluate(
                  ({ svg, filename }) => {
                    const url = URL.createObjectURL(
                      new Blob([svg], { type: "image/svg+xml" }),
                    );
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = filename;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 500);
                  },
                  { svg: result[mode], filename },
                );
                await (await download).saveAs(root + "/exports/" + filename);
                assert.equal(
                  await readFile(root + "/exports/" + filename, "utf8"),
                  result[mode],
                );
              }
              result.svgSHA256 = hash(result.svg);
              result.autoSHA256 = hash(result.autoSvg);
              result.components = {
                inverse: result.inverse,
                recovery: result.recovery,
                initialization: result.initialization,
                largeApex: result.largeApex,
              };
              delete result.svg;
              delete result.autoSvg;
            }
            const row = {
              id,
              session,
              condition,
              input: { ...input, bytes: undefined },
              manifests,
              task,
              clockValid,
              callbackMs,
              calls,
              outputs,
              cpuGroup: deltaCPU(before, after),
              systemBefore: before,
              systemAfter: after,
              observerCpuMs: osData?.observerCpuMs,
              hardware: osData?.hardwareCapabilities,
            };
            all.push(row);
            await writeFile(root + "/" + id + ".json", JSON.stringify(row));
            await appendFile(
              root + "/observations.jsonl",
              JSON.stringify(row) + "\n",
            );
            console.log(
              JSON.stringify({
                id,
                callbackMs,
                calls: calls.map((c) => [
                  c.key,
                  c.round,
                  c.coreMs,
                  c.cpu?.cpuLowerMs,
                  c.cpu?.cpuUpperMs,
                ]),
              }),
            );
          } finally {
            if (sampler) {
              sampler.stdin.end("\n");
              await once(sampler, "close");
            }
            if (stopTrace) await stopTrace();
            await page.close();
          }
        }
      }
    } finally {
      await browser.close();
    }
  }
  const groups = new Map();
  for (const row of all)
    for (const [key, value] of Object.entries(row.outputs)) {
      for (const [mode, sha] of [
        ["research", value.svgSHA256],
        ["auto", value.autoSHA256],
      ]) {
        const k = row.input.key + "/" + mode;
        const set = groups.get(k) ?? new Set();
        set.add(sha);
        groups.set(k, set);
      }
    }
  const identity = [...groups].map(([key, values]) => ({
    key,
    hashes: [...values],
  }));
  const failures = identity.filter((r) => r.hashes.length !== 1);
  const summary = {
    groups: all.length,
    timedCalls: all.flatMap((r) => r.calls).length,
    identity,
    failures,
    severe: all.flatMap((r) =>
      r.calls
        .filter((c) => c.coreMs >= 2000)
        .map((c) => ({ group: r.id, ...c })),
    ),
    status:
      "Diagnostic observation only; no cause/fix inferred from correlation.",
  };
  await writeFile(root + "/summary.json", JSON.stringify(summary, null, 2));
  assert.equal(failures.length, 0, "Output identity changed");
} finally {
  await new Promise((r) => server.close(r));
}
