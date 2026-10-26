// Same immutable module through direct export, a dedicated Worker, and the app.
// Never overwrites historical scores, src/engine/wasm or normal dist.
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { createHash } from "node:crypto";
import { cpus, release } from "node:os";
import { chromium } from "@playwright/test";
import sharp from "sharp";
import { optional, snapshot, deltaCPU } from "./runtime-cross-system.mjs";
import { distribution } from "./runtime-statistics.mjs";
const buildsRoot = resolve(process.env.NEXORA_CROSS_BUILDS);
const root = resolve(process.env.NEXORA_CROSS_ROOT);
await mkdir(root);
await mkdir(root + "/exports");
await mkdir(root + "/traces");
const buildIds = (
  process.env.NEXORA_CROSS_MODULES || "stage16f,stage16h"
).split(",");
const modes = (process.env.NEXORA_CROSS_MODES || "worker,direct,app").split(
  ",",
);
const repetitions = Number(process.env.NEXORA_CROSS_SESSIONS || 3),
  warms = Number(process.env.NEXORA_CROSS_WARMS || 3);
if (
  !Number.isInteger(repetitions) ||
  repetitions < 2 ||
  !Number.isInteger(warms) ||
  warms < 2
)
  throw Error("Independent sessions and multiple warms required");
if (modes.some((m) => !["worker", "direct", "app"].includes(m)))
  throw Error("Invalid pathway");
const fixtures = [
  ["wave-1024", "curve-optimization/wave-1024", 1024],
  ["triangle-512", "acute-geometry/triangle-eight-native-srgb-512", 512],
  ["rounded-1024", "acute-geometry/rounded-blade-native-srgb-1024", 1024],
  ["thin-ellipse-1024", "acute-geometry/thin-ellipse-native-srgb-1024", 1024],
  ["wave-128", "curve-optimization/wave-128", 128],
]
  .map(([key, file, size]) => ({
    key,
    file: "tests/fixtures/" + file + ".png",
    size,
  }))
  .filter(
    (f) =>
      !process.env.NEXORA_CROSS_FIXTURES ||
      process.env.NEXORA_CROSS_FIXTURES.split(",").includes(f.key),
  );
if (!fixtures.length) throw Error("No fixtures");
const hash = (b) => createHash("sha256").update(b).digest("hex");
const manifests = {},
  buffers = {},
  wrappers = {};
let template = await readFile(
  "scripts/runtime-cross-module.mjs.template",
  "utf8",
);
for (const id of buildIds) {
  const dir = buildsRoot + "/" + id;
  const m = JSON.parse(await readFile(dir + "/manifest.json"));
  const wasm = await readFile(dir + "/nexora_wasm_bg.wasm");
  if (hash(wasm) !== m.wasmSHA256)
    throw Error("Immutable binary changed: " + id);
  manifests[id] = { ...m, dir };
  buffers[id] = wasm;
  wrappers[id] = template
    .replaceAll("__CORE__", JSON.stringify("/binary/" + id + "/nexora_wasm.js"))
    .replaceAll("__BUILD_ID__", JSON.stringify(id));
}
for (const f of fixtures) {
  f.png = await readFile(f.file);
  f.sourceSHA256 = hash(f.png);
  f.sharpRgbaSHA256 = hash(await sharp(f.png).ensureAlpha().raw().toBuffer());
}
const servedBinaries = [];
const worker = `let m;onmessage=async({data:d})=>{try{if(d.init){const start=performance.now();m=await import('/module/'+d.init+'.mjs');const imported=performance.now();await m.default();postMessage({id:d.id,importMs:imported-start,instantiateMs:performance.now()-imported});return;}m.trace_quality(new Uint8Array(d.bytes),d.size,d.size,'illustration','inverse-reduce-reconstruct');postMessage({id:d.id,packet:await m.telemetry()});}catch(e){postMessage({id:d.id,error:String(e)})}};`;
const mime = (p) =>
  ({
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".wasm": "application/wasm",
    ".css": "text/css",
    ".html": "text/html",
    ".png": "image/png",
  })[extname(p)] || "application/octet-stream";
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const parts = url.pathname.split("/");
    res.setHeader("Cache-Control", "no-store");
    if (url.pathname === "/") {
      res.end("<body>Cross-harness runtime diagnostics</body>");
      return;
    }
    if (url.pathname === "/worker.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(worker);
      return;
    }
    if (parts[1] === "input") {
      const f = fixtures.find((f) => f.key === parts[2]);
      if (!f) throw Error("404");
      res.setHeader("Content-Type", "image/png");
      res.end(f.png);
      return;
    }
    if (parts[1] === "module" && wrappers[parts[2]?.replace(".mjs", "")]) {
      res.setHeader("Content-Type", "text/javascript");
      res.end(wrappers[parts[2].replace(".mjs", "")]);
      return;
    }
    const id = parts[2];
    if (!manifests[id]) throw Error("404");
    if (
      parts[1] === "binary" &&
      ["nexora_wasm.js", "nexora_wasm_bg.wasm"].includes(parts[3])
    ) {
      res.setHeader("Content-Type", mime(parts[3]));
      if (parts[3].endsWith(".wasm")) {
        servedBinaries.push({
          id,
          url: req.url,
          sha256: hash(buffers[id]),
          at: new Date().toISOString(),
        });
        res.end(buffers[id]);
      } else res.end(await readFile(manifests[id].dir + "/nexora_wasm.js"));
      return;
    }
    if (parts[1] === "app") {
      const rel = parts.slice(3).join("/") || "index.html";
      const path = resolve(manifests[id].dir + "/app", rel);
      if (!path.startsWith(manifests[id].dir + "/app/")) throw Error("404");
      res.setHeader("Content-Type", mime(path));
      res.end(await readFile(path));
      return;
    }
    throw Error("404");
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = "http://127.0.0.1:" + server.address().port;
const observations = [],
  failures = [];
const env = {
  commit:
    "3268ab3fb15c0ce650bc45ab3ff9b0c458f9b2d4 engine source; runtime harness hash identifies instrumentation",
  node: process.version,
  kernel: release(),
  cpu: cpus()[0]?.model,
  visibleCPUs: cpus().length,
  quota: await optional("/sys/fs/cgroup/cpu.max"),
  allowedCPUs:
    (await optional("/proc/self/status"))?.match(
      /Cpus_allowed_list:\s*(.*)/,
    )?.[1] ?? null,
  frequency: await optional(
    "/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq",
  ),
  builds: manifests,
  repetitions,
  warms,
  modes,
  fixtures: fixtures.map(({ png, ...f }) => f),
  harnessSHA256: hash(await readFile(new URL(import.meta.url))),
  traceEnabled: process.env.NEXORA_CROSS_TRACE !== "0",
  flags: process.env.NEXORA_CROSS_JS_FLAGS || "default",
  policy:
    "All observations retained; sessions use separate browser processes. Two A/A slots per binary and mode, alternating execution order. Work counters absent from production modules are null, never invented. Timers overlap. No historical gate is replaced.",
};
env.protocolSHA256 = Object.fromEntries(
  await Promise.all(
    [
      "runtime-cross-harness.mjs",
      "runtime-cross-system.mjs",
      "runtime-cross-module.mjs.template",
      "runtime-cross-apps.mjs",
    ].map(async (name) => [name, hash(await readFile("scripts/" + name))]),
  ),
);
await mkdir(root + "/protocol");
for (const name of Object.keys(env.protocolSHA256))
  await writeFile(
    root + "/protocol/" + name,
    await readFile("scripts/" + name),
  );
await writeFile(root + "/environment.json", JSON.stringify(env, null, 2));
function check(ok, reason, fields = {}) {
  if (!ok) failures.push({ reason, ...fields });
}
async function setup(page, id, mode, f) {
  const started = performance.now();
  await page.goto(mode === "app" ? `${origin}/app/${id}/index.html` : origin);
  if (mode === "app") {
    await page
      .getByLabel("Pilih gambar", { exact: true })
      .setInputFiles(f.file);
    await page.locator('input[name="preset"][value="illustration"]').check();
    await page
      .getByLabel("Profil kontur", { exact: true })
      .selectOption("source");
    await page.getByLabel("Optimalkan node", { exact: true }).setChecked(true);
    await page
      .getByLabel("Refinement sumber", { exact: true })
      .setChecked(true);
    return { setupMs: performance.now() - started };
  }
  return page.evaluate(
    async ({ id, mode, key, started }) => {
      const t = performance.now();
      const blob = await (await fetch("/input/" + key)).blob();
      const bitmap = await createImageBitmap(blob);
      const c = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0);
      window.bytes = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
      bitmap.close();
      const decodeMs = performance.now() - t;
      if (mode === "direct") {
        const m = performance.now();
        window.module = await import("/module/" + id + ".mjs");
        const imported = performance.now();
        await window.module.default();
        return {
          decodeMs,
          importMs: imported - m,
          instantiateMs: performance.now() - imported,
        };
      }
      window.serial = 0;
      const w = new Worker("/worker.js", { type: "module" });
      window.traceWorker = w;
      window.rpc = (data) =>
        new Promise((resolve, reject) => {
          const serial = ++window.serial;
          w.onmessage = (e) => {
            if (e.data.id === serial)
              e.data.error ? reject(Error(e.data.error)) : resolve(e.data);
          };
          w.onerror = reject;
          w.postMessage(
            { id: serial, ...data },
            data.bytes ? [data.bytes] : [],
          );
        });
      const m = performance.now();
      const initialized = await window.rpc({ init: id });
      return {
        decodeMs,
        ...initialized,
        startupRoundTripMs: performance.now() - m,
      };
    },
    { id, mode, key: f.key },
  );
}
try {
  for (let rep = 0; rep < repetitions; rep++) {
    const browser = await chromium.launch({
      executablePath: process.env.NEXORA_CHROMIUM_PATH,
      args: process.env.NEXORA_CROSS_JS_FLAGS
        ? ["--js-flags=" + process.env.NEXORA_CROSS_JS_FLAGS]
        : [],
    });
    const cdp = await browser.newBrowserCDPSession();
    const tracePath = root + `/traces/session-${rep}.jsonl`;
    let traceWrites = Promise.resolve();
    if (env.traceEnabled) {
      cdp.on("Tracing.dataCollected", (e) => {
        const text = e.value.map((x) => JSON.stringify(x)).join("\n") + "\n";
        traceWrites = traceWrites.then(() => appendFile(tracePath, text));
      });
      await cdp.send("Tracing.start", {
        categories:
          "v8,disabled-by-default-v8.wasm,disabled-by-default-v8.gc,devtools.timeline,blink.user_timing",
        transferMode: "ReportEvents",
      });
    }
    await writeFile(
      root + `/browser-${rep}.json`,
      JSON.stringify({
        version: browser.version(),
        processInfo: (await cdp.send("SystemInfo.getProcessInfo")).processInfo,
      }),
    );
    try {
      const orderedFixtures = rep % 2 ? [...fixtures].reverse() : fixtures;
      for (let fi = 0; fi < orderedFixtures.length; fi++) {
        const f = orderedFixtures[fi];
        const orderBuilds = (rep + fi) % 2 ? [...buildIds].reverse() : buildIds;
        for (const id of orderBuilds)
          for (let mi = 0; mi < modes.length; mi++) {
            const mode = modes[(mi + rep) % modes.length];
            const holders = [];
            for (const slot of [0, 1]) {
              const context = await browser.newContext({
                acceptDownloads: true,
              });
              await context.addInitScript(() => {
                window.__nxPackets = [];
                const Native = window.Worker;
                window.Worker = class extends Native {
                  constructor(...args) {
                    super(...args);
                    this.addEventListener("message", (e) => {
                      if (e.data.__nexoraForensics)
                        window.__nxPackets.push(e.data.__nexoraForensics);
                    });
                  }
                };
                let previous = null;
                document.addEventListener(
                  "click",
                  (e) => {
                    if (
                      e.target
                        .closest("button")
                        ?.textContent.includes("Konversi ke SVG")
                    ) {
                      window.__nxClickedAt = performance.now();
                      previous = document.querySelector(
                        ".result[data-metrics]",
                      );
                    }
                  },
                  true,
                );
                new MutationObserver(() => {
                  const result = document.querySelector(
                    ".result[data-metrics]",
                  );
                  if (
                    result &&
                    result !== previous &&
                    window.__nxClickedAt != null
                  ) {
                    window.__nxResultReadyMs =
                      performance.now() - window.__nxClickedAt;
                    previous = result;
                    window.__nxClickedAt = null;
                  }
                }).observe(document, { subtree: true, childList: true });
              });
              const page = await context.newPage();
              page.setDefaultTimeout(180000);
              holders.push({
                context,
                page,
                setup: await setup(page, id, mode, f),
              });
            }
            try {
              for (let round = 0; round < warms + 2; round++)
                for (const slot of (round + rep + fi + mi) % 2
                  ? [1, 0]
                  : [0, 1]) {
                  const holder = holders[slot],
                    state =
                      round === warms + 1
                        ? "reset"
                        : round === 0
                          ? "first"
                          : "warm";
                  if (state === "reset") {
                    if (mode === "worker")
                      await holder.page.evaluate(() =>
                        window.traceWorker.terminate(),
                      );
                    if (mode === "app")
                      await holder.page
                        .getByRole("button", { name: "Reset", exact: true })
                        .click();
                    // A direct page has no Worker: reset means a new JS realm/module instance.
                    if (mode !== "app") {
                      await holder.page.close();
                      holder.page = await holder.context.newPage();
                      holder.page.setDefaultTimeout(180000);
                    }
                    holder.setup = await setup(holder.page, id, mode, f);
                  }
                  const page = holder.page;
                  const traceId = `s${rep}-${f.key}-${id}-${mode}-${slot}-${round}`;
                  const before = await snapshot(cdp);
                  const started = process.hrtime.bigint();
                  let packet,
                    appMetrics = null,
                    download;
                  if (mode === "app") {
                    const n = await page.evaluate(
                      () => window.__nxPackets.length,
                    );
                    await page
                      .getByRole("button", { name: "Konversi ke SVG" })
                      .click();
                    await page.waitForFunction(
                      (n) => window.__nxPackets.length > n,
                      n,
                      { timeout: 180000 },
                    );
                    await page
                      .getByRole("link", { name: "Download SVG" })
                      .waitFor({ state: "visible" });
                    packet = await page.evaluate(() => ({
                      ...window.__nxPackets.at(-1),
                      appResultReadyMs: window.__nxResultReadyMs,
                    }));
                    appMetrics = JSON.parse(
                      await page
                        .locator(".result")
                        .getAttribute("data-metrics"),
                    );
                  } else {
                    packet = await page.evaluate(
                      async ({ mode, size }) => {
                        const start = performance.now();
                        let packet;
                        if (mode === "worker") {
                          const copying = performance.now();
                          const copy = window.bytes.slice();
                          const copyMs = performance.now() - copying;
                          packet = (
                            await window.rpc({ bytes: copy.buffer, size })
                          ).packet;
                          packet.transferCopyMs = copyMs;
                        } else {
                          window.module.trace_quality(
                            new Uint8Array(window.bytes.buffer),
                            size,
                            size,
                            "illustration",
                            "inverse-reduce-reconstruct",
                          );
                          packet = await window.module.telemetry();
                        }
                        packet.pageResultMs = performance.now() - start;
                        return packet;
                      },
                      { mode, size: f.size },
                    );
                  }
                  const resultWallMs =
                    Number(process.hrtime.bigint() - started) / 1e6;
                  const after = await snapshot(cdp);
                  const downloadStart = process.hrtime.bigint();
                  const event = page.waitForEvent("download");
                  if (mode === "app")
                    await page
                      .getByRole("link", { name: "Download SVG" })
                      .click();
                  else
                    await page.evaluate((svg) => {
                      const url = URL.createObjectURL(
                        new Blob([svg], { type: "image/svg+xml" }),
                      );
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = "direct-export.svg";
                      a.click();
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                    }, packet.svg);
                  download = await event;
                  const downloadEventMs =
                    Number(process.hrtime.bigint() - downloadStart) / 1e6;
                  const file = await download.path();
                  const downloadBytes = await readFile(file);
                  const downloadSHA256 = hash(downloadBytes);
                  const canonical = await page.evaluate((svg) => {
                    const root = new DOMParser().parseFromString(
                      svg,
                      "image/svg+xml",
                    ).documentElement;
                    if (!root.hasAttribute("viewBox"))
                      root.setAttribute(
                        "viewBox",
                        `0 0 ${root.getAttribute("width")} ${root.getAttribute("height")}`,
                      );
                    return new XMLSerializer().serializeToString(root);
                  }, packet.svg);
                  check(
                    mode !== "app" || hash(canonical) === downloadSHA256,
                    "app sanitizer/export mismatch",
                    { traceId },
                  );
                  check(
                    packet.args[0] === f.size &&
                      packet.args[1] === f.size &&
                      packet.args[2] === "illustration",
                    "input options mismatch",
                    { traceId, args: packet.args },
                  );
                  const comparable =
                    packet.args[3] === "inverse-reduce-reconstruct";
                  check(
                    comparable,
                    "app selected a different trace operation; do not pool",
                    { traceId, args: packet.args },
                  );
                  check(
                    packet.rgbaSHA256 === f.sharpRgbaSHA256,
                    "source decode differs; do not pool",
                    {
                      traceId,
                      rgbaSHA256: packet.rgbaSHA256,
                      expected: f.sharpRgbaSHA256,
                    },
                  );
                  const filename =
                    f.key +
                    "-" +
                    id +
                    "-" +
                    packet.svgSHA256.slice(0, 12) +
                    ".svg";
                  await writeFile(root + "/exports/" + filename, packet.svg);
                  if (mode === "app")
                    await writeFile(
                      root +
                        "/exports/" +
                        f.key +
                        "-" +
                        id +
                        "-app-" +
                        downloadSHA256.slice(0, 12) +
                        ".svg",
                      downloadBytes,
                    );
                  const row = {
                    traceId,
                    rep,
                    fixture: f.key,
                    width: f.size,
                    height: f.size,
                    sourceSHA256: f.sourceSHA256,
                    wasmSHA256: manifests[id].wasmSHA256,
                    commit: manifests[id].commit,
                    features: manifests[id].features,
                    mode,
                    slot,
                    round,
                    state,
                    comparable,
                    ...packet,
                    appMetrics,
                    initialization: holder.setup,
                    resultWallMs,
                    downloadEventMs,
                    downloadSHA256,
                    downloadBytes: downloadBytes.length,
                    cpu: deltaCPU(before, after),
                    systemBefore: before,
                    systemAfter: after,
                  };
                  delete row.svg;
                  observations.push(row);
                  await appendFile(
                    root + "/observations.jsonl",
                    JSON.stringify(row) + "\n",
                  );
                }
            } finally {
              for (const h of holders) await h.context.close();
            }
            console.log(
              "session",
              rep + 1,
              f.key,
              id,
              mode,
              observations.length,
            );
          }
      }
    } finally {
      if (env.traceEnabled) {
        const completed = new Promise((r) =>
          cdp.once("Tracing.tracingComplete", r),
        );
        await cdp.send("Tracing.end");
        await completed;
        await traceWrites;
      }
      await browser.close();
    }
  }
  const summary = [];
  for (const f of fixtures)
    for (const id of buildIds)
      for (const mode of modes)
        for (const state of ["first", "warm", "reset"]) {
          const r = observations.filter(
            (r) =>
              r.fixture === f.key &&
              r.buildId === id &&
              r.mode === mode &&
              r.state === state,
          );
          const sessions = Array.from({ length: repetitions }, (_, rep) => ({
            rep,
            slots: [0, 1].map((slot) =>
              distribution(
                r
                  .filter((r) => r.rep === rep && r.slot === slot)
                  .map((r) => r.coreMs),
              ),
            ),
          }));
          summary.push({
            fixture: f.key,
            buildId: id,
            mode,
            state,
            core: distribution(r.map((r) => r.coreMs)),
            rust: distribution(
              r.flatMap((r) => (r.runtime ? [r.runtime[32]] : [])),
            ),
            pageResult: distribution(
              r.map((r) => r.pageResultMs ?? r.appResultReadyMs),
            ),
            resultWall: distribution(r.map((r) => r.resultWallMs)),
            getters: distribution(r.map((r) => r.gettersMs)),
            hash: distribution(r.map((r) => r.hashMs)),
            sessions,
          });
        }
  for (const f of fixtures) {
    const r = observations.filter((r) => r.fixture === f.key);
    check(
      new Set(r.map((r) => r.svgSHA256)).size === 1,
      "engine SVG identity across pathways/binaries",
      { fixture: f.key },
    );
  }
  const signatures = [];
  for (const id of buildIds)
    for (const f of fixtures) {
      const r = observations.filter(
        (r) => r.buildId === id && r.fixture === f.key,
      );
      const complete = r.every((r) => r.runtime && r.inverseWork);
      const sig = [
        ...new Set(
          r.map((r) =>
            JSON.stringify(
              complete
                ? [...r.runtime.slice(0, 32), ...r.inverseWork.slice(0, 16)]
                : [
                    r.inverse[0],
                    r.inverse[1],
                    r.inverse[2],
                    r.recovery?.[0],
                    r.recovery?.[1],
                    r.recovery?.[2],
                  ],
            ),
          ),
        ),
      ];
      check(
        sig.length === 1,
        "work signatures differ; attribute before comparing",
        { id, fixture: f.key, complete, signatures: sig },
      );
      signatures.push({ id, fixture: f.key, complete, signatures: sig });
    }
  await writeFile(root + "/observations.json", JSON.stringify(observations));
  await writeFile(root + "/summary.json", JSON.stringify(summary, null, 2));
  await writeFile(
    root + "/binary-requests.json",
    JSON.stringify(servedBinaries, null, 2),
  );
  const result = {
    status: failures.length ? "FAIL" : "PARTIAL",
    invariants: failures.length ? "FAIL" : "PASS",
    observations: observations.length,
    failures,
    signatures,
    scope:
      "Diagnostic execution and identity/work equivalence only; historical latency causality not automatically established.",
  };
  await writeFile(root + "/invariants.json", JSON.stringify(result, null, 2));
  console.log(result);
  if (failures.length) process.exitCode = 1;
} finally {
  await new Promise((r) => server.close(r));
}
