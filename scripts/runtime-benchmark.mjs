// New diagnostic policy only. Never retries, discards outliers or edits old gates.
import { createServer } from "node:http";
import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  appendFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { cpus, release, platform } from "node:os";
import { chromium } from "@playwright/test";
import { distribution } from "./runtime-statistics.mjs";
const builds = JSON.parse(process.env.NEXORA_RUNTIME_BUILDS || "null");
if (!builds)
  throw Error(
    "NEXORA_RUNTIME_BUILDS must map immutable labels to module directories",
  );
const root = resolve(process.env.NEXORA_RUNTIME_ROOT);
await mkdir(root);
await mkdir(root + "/exports");
const pairs = JSON.parse(
  process.env.NEXORA_RUNTIME_PAIRS || '[["E","E"],["F","F"],["E","F"]]',
);
const repetitions = Number(process.env.NEXORA_RUNTIME_REPETITIONS || 3),
  warms = Number(process.env.NEXORA_RUNTIME_WARMS || 4);
if (repetitions < 2 || warms < 2)
  throw Error("Independent repetitions and warm samples required");
const fixtures = [
  ...["cubic", "wave"].flatMap((n) =>
    [128, 512, 1024].map((size) => ({
      key: n + "-" + size,
      path: `tests/fixtures/curve-optimization/${n}-${size}.png`,
      size,
    })),
  ),
  ...[128, 512, 1024].map((size) => ({
    key: "triangle-" + size,
    path: `tests/fixtures/acute-geometry/triangle-eight-native-srgb-${size}.png`,
    size,
  })),
];
fixtures.push(
  {
    key: "rounded-128",
    path: "tests/fixtures/acute-geometry/rounded-blade-native-srgb-128.png",
    size: 128,
    negative: true,
  },
  {
    key: "parallel-512",
    path: "tests/fixtures/acute-geometry/parallel-uncertain-native-srgb-512.png",
    size: 512,
    negative: true,
  },
);
fixtures.push(
  ...[
    ["thin-ellipse-1024", "thin-ellipse-native-srgb-1024", 1024],
    ["blade-512", "blade-narrow-native-srgb-512", 512],
  ].map(([key, name, size]) => ({
    key,
    path: `tests/fixtures/acute-geometry/${name}.png`,
    size,
    negative: true,
  })),
);
const selected = process.env.NEXORA_RUNTIME_FIXTURES?.split(",");
const cases = fixtures.filter((f) =>
  selected ? selected.includes(f.key) : !f.negative,
);
if (!cases.length || !Number.isInteger(repetitions) || !Number.isInteger(warms))
  throw Error("Invalid empty/runtime sample configuration");
const workerCode = `let m, memory;self.onmessage=async({data:d})=>{try{if(d.init){const t=performance.now();m=await import('/'+d.init+'/nexora_wasm.js');const imported=performance.now();const w=await m.default();memory=w.memory;postMessage({id:d.id,importMs:imported-t,instantiateMs:performance.now()-imported});return;}const start=performance.now();const svg=m.trace_quality(new Uint8Array(d.bytes),d.size,d.size,'illustration','inverse-reduce-reconstruct');const wasmMs=performance.now()-start;const g=performance.now();const r={svg,wasmMs,stages:[...m.last_stage_timings()],recovery:m.last_recovery?[...m.last_recovery()]:[],inverse:[...m.last_inverse()],large:m.last_large_apex?[...m.last_large_apex()]:[],inverseWork:m.last_inverse_work?[...m.last_inverse_work()]:[],inverseWorkNames:m.inverse_work_names?m.inverse_work_names().split("|"):[],runtime:m.last_runtime_profile?[...m.last_runtime_profile()]:[],memory:memory.buffer.byteLength};r.profileNames=m.runtime_profile_names?m.runtime_profile_names().split("|"):[];r.gettersMs=performance.now()-g;postMessage({id:d.id,...r});}catch(e){postMessage({id:d.id,error:String(e)});}};`;
const files = {};
for (const f of cases) files["/input/" + f.key] = await readFile(f.path);
const server = createServer(async (req, res) => {
  try {
    if (req.url === "/") {
      res.end("<body>Runtime research</body>");
      return;
    }
    if (req.url === "/worker.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(workerCode);
      return;
    }
    if (files[req.url]) {
      res.setHeader("Content-Type", "image/png");
      res.end(files[req.url]);
      return;
    }
    const [, label, file] = req.url.split("/");
    if (
      !builds[label] ||
      !["nexora_wasm.js", "nexora_wasm_bg.wasm"].includes(file)
    )
      throw Error("404");
    res.setHeader(
      "Content-Type",
      file.endsWith(".wasm") ? "application/wasm" : "text/javascript",
    );
    res.end(await readFile(resolve(builds[label], file)));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({
  args: process.env.NEXORA_JS_FLAGS
    ? ["--js-flags=" + process.env.NEXORA_JS_FLAGS]
    : [],
  executablePath: process.env.NEXORA_CHROMIUM_PATH,
});
const cdp = await browser.newBrowserCDPSession();
const traceEvents = [];
if (process.env.NEXORA_RUNTIME_TRACE) {
  cdp.on("Tracing.dataCollected", (e) => traceEvents.push(...e.value));
  await cdp.send("Tracing.start", {
    categories: "v8,disabled-by-default-v8.wasm,disabled-by-default-v8.gc",
    transferMode: "ReportEvents",
  });
}
const optional = async (path) => {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
};
async function cpu() {
  const { processInfo } = await cdp.send("SystemInfo.getProcessInfo");
  const threads = {};
  for (const proc of processInfo.filter((p) => p.type === "renderer")) {
    let tids = [];
    try {
      tids = await readdir(`/proc/${proc.id}/task`);
    } catch {}
    for (const tid of tids) {
      const base = `/proc/${proc.id}/task/${tid}`;
      const [comm, stat] = await Promise.all([
        optional(base + "/comm"),
        optional(base + "/schedstat"),
      ]);
      if (stat && comm) {
        const [run, wait] = stat.trim().split(/\s+/).map(Number);
        threads[proc.id + ":" + tid] = { comm: comm.trim(), run, wait };
      }
    }
  }
  return {
    processInfo,
    threads,
    cgroup: await optional("/sys/fs/cgroup/cpu.stat"),
    pressure: await optional("/sys/fs/cgroup/cpu.pressure"),
  };
}
function deltaCPU(a, b) {
  const result = [];
  for (const [id, t] of Object.entries(b.threads)) {
    const before = a.threads[id];
    if (before && t.run >= before.run)
      result.push({
        id,
        comm: t.comm,
        cpuMs: (t.run - before.run) / 1e6,
        runqueueMs: (t.wait - before.wait) / 1e6,
      });
  }
  return result.sort((a, b) => b.cpuMs - a.cpuMs);
}
const meta = {
  jsFlags: process.env.NEXORA_JS_FLAGS || "default",
  harnessSHA256: createHash("sha256")
    .update(await readFile(new URL(import.meta.url)))
    .digest("hex"),
  node: process.version,
  browser: browser.version(),
  platform: platform(),
  kernel: release(),
  cpu: cpus()[0]?.model,
  logicalCPUs: cpus().length,
  quota: await optional("/sys/fs/cgroup/cpu.max"),
  repetitions,
  warms,
  pairs,
  cases,
  builds: {},
  policy:
    "All observations kept. Alternating first/warm order. No compile-cache reset; cold means fresh module instance, not guaranteed cold machine/code cache. CPU snapshots outside trace timers; worker CPU includes wrapper and diagnostics; counters/timers may nest.",
};
for (const [k, dir] of Object.entries(builds))
  meta.builds[k] = {
    dir: resolve(dir),
    wasmSha256: createHash("sha256")
      .update(await readFile(resolve(dir, "nexora_wasm_bg.wasm")))
      .digest("hex"),
  };
await writeFile(root + "/environment.json", JSON.stringify(meta, null, 2));
const observations = [];
try {
  for (const f of cases)
    for (let rep = 0; rep < repetitions; rep++)
      for (let pairIndex = 0; pairIndex < pairs.length; pairIndex++) {
        const pair = pairs[pairIndex],
          page = await browser.newPage();
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        const decoded = await page.evaluate(async (key) => {
          const t = performance.now();
          const blob = await (await fetch("/input/" + key)).blob();
          const image = await createImageBitmap(blob);
          const c = new OffscreenCanvas(image.width, image.height);
          const ctx = c.getContext("2d");
          ctx.drawImage(image, 0, 0);
          window.bytes = ctx.getImageData(0, 0, image.width, image.height).data;
          image.close();
          window.workers = {};
          window.next = 0;
          window.request = (w, data, transfer = []) =>
            new Promise((resolve, reject) => {
              const id = ++window.next;
              w.onmessage = (e) =>
                e.data.id === id &&
                (e.data.error ? reject(Error(e.data.error)) : resolve(e.data));
              w.onerror = reject;
              w.postMessage({ id, ...data }, transfer);
            });
          return { decodeMs: performance.now() - t };
        }, f.key);
        for (const slot of [0, 1])
          await page.evaluate(
            async ({ slot, label }) => {
              const t = performance.now();
              const w = new Worker("/worker.js", { type: "module" });
              window.workers[slot] = {
                w,
                label,
                init: await window.request(w, { init: label }),
              };
              window.workers[slot].init.startupRoundTripMs =
                performance.now() - t;
            },
            { slot, label: pair[slot] },
          );
        for (let round = 0; round < warms + 2; round++) {
          const reset = round === warms + 1;
          const order = (rep + round + pairIndex) % 2 ? [1, 0] : [0, 1];
          for (const slot of order) {
            if (reset)
              await page.evaluate(async (slot) => {
                const { w, label } = window.workers[slot];
                w.terminate();
                const next = new Worker("/worker.js", { type: "module" });
                const t = performance.now();
                window.workers[slot] = {
                  w: next,
                  label,
                  init: await window.request(next, { init: label }),
                };
                window.workers[slot].init.startupRoundTripMs =
                  performance.now() - t;
              }, slot);
            const before = await cpu();
            const host = process.hrtime.bigint();
            const result = await page.evaluate(
              async ({ slot, size }) => {
                const t = performance.now();
                const copy = window.bytes.slice();
                const transferCopyMs = performance.now() - t;
                const r = await window.request(
                  window.workers[slot].w,
                  { bytes: copy.buffer, size },
                  [copy.buffer],
                );
                r.browserRoundTripMs = performance.now() - t;
                r.transferCopyMs = transferCopyMs;
                r.initialization = window.workers[slot].init;
                return r;
              },
              { slot, size: f.size },
            );
            const hostRoundTripMs =
              Number(process.hrtime.bigint() - host) / 1e6;
            const after = await cpu();
            const hash = createHash("sha256").update(result.svg).digest("hex");
            await writeFile(
              root +
                "/exports/" +
                f.key +
                "-" +
                pair[slot] +
                "-" +
                hash.slice(0, 12) +
                ".svg",
              result.svg,
            );
            delete result.svg;
            const row = {
              fixture: f.key,
              pair: pair.join("/"),
              pairIndex,
              rep,
              slot,
              round,
              state: reset ? "reset" : round === 0 ? "first" : "warm",
              order,
              hash,
              ...decoded,
              ...result,
              hostRoundTripMs,
              cpu: deltaCPU(before, after),
              systemBefore: before,
              systemAfter: after,
            };
            observations.push(row);
            await appendFile(
              root + "/observations.jsonl",
              JSON.stringify(row) + "\n",
            );
          }
        }
        await page.close();
        console.log(f.key, pair.join("/"), "repetition", rep + 1);
      }
  await writeFile(root + "/observations.json", JSON.stringify(observations));
  const summary = [];
  for (const f of cases)
    for (let pi = 0; pi < pairs.length; pi++)
      for (const state of ["first", "warm", "reset"]) {
        const slots = [0, 1].map((slot) => {
          const rows = observations.filter(
            (r) =>
              r.fixture === f.key &&
              r.pairIndex === pi &&
              r.slot === slot &&
              r.state === state,
          );
          return {
            label: pairs[pi][slot],
            wasm: distribution(rows.map((r) => r.wasmMs)),
            browser: distribution(rows.map((r) => r.browserRoundTripMs)),
            host: distribution(rows.map((r) => r.hostRoundTripMs)),
            workerCPU: distribution(
              rows.map((r) =>
                r.cpu
                  .filter((t) => t.comm.includes("DedicatedWorker"))
                  .reduce((a, t) => a + t.cpuMs, 0),
              ),
            ),
            workerRunqueue: distribution(
              rows.map((r) =>
                r.cpu
                  .filter((t) => t.comm.includes("DedicatedWorker"))
                  .reduce((a, t) => a + t.runqueueMs, 0),
              ),
            ),
            hashes: [...new Set(rows.map((r) => r.hash))],
          };
        });
        summary.push({
          fixture: f.key,
          pair: pairs[pi].join("/"),
          state,
          slots,
          additionalMedianMs: slots[1].wasm.median - slots[0].wasm.median,
        });
      }
  await writeFile(root + "/summary.json", JSON.stringify(summary, null, 2));
  // Identity is strict within A/A, and between F and instrumented/candidate G.
  for (const s of summary) {
    if (
      (s.pair === "E/E" || s.pair === "F/F" || s.pair === "F/G") &&
      JSON.stringify(s.slots[0].hashes) !== JSON.stringify(s.slots[1].hashes)
    )
      throw Error("Geometry identity failed " + s.fixture + " " + s.pair);
  }
  await writeFile(
    root + "/identity.json",
    JSON.stringify({
      status: "PASS",
      observations: observations.length,
      scope: "A/A and F/G hashes; E/F Triangle128 is expected to differ",
    }),
  );
  console.log(
    "Recorded",
    observations.length,
    "observations; no observations discarded",
  );
} finally {
  if (process.env.NEXORA_RUNTIME_TRACE) {
    const completed = new Promise((r) =>
      cdp.once("Tracing.tracingComplete", r),
    );
    await cdp.send("Tracing.end");
    await completed;
    await writeFile(
      root + "/chrome-trace.json",
      JSON.stringify({ traceEvents }),
    );
  }
  await browser.close();
  await new Promise((r) => server.close(r));
}
