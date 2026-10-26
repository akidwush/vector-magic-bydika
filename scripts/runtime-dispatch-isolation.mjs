// One-factor experiment: same realm, binary, input and ordered calls, with or
// without a task yield between calls. Reuses Stage I telemetry/CPU definitions.
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import sharp from "sharp";
import { snapshot, deltaCPU } from "./runtime-cross-system.mjs";
import { distribution } from "./runtime-statistics.mjs";
const root = resolve(process.env.NEXORA_DISPATCH_ROOT),
  builds = resolve(process.env.NEXORA_CROSS_BUILDS);
await mkdir(root);
await mkdir(root + "/traces");
const hash = (b) => createHash("sha256").update(b).digest("hex");
const ids = ["stage16f", "stage16h"],
  data = {};
const template = await readFile(
  "scripts/runtime-cross-module.mjs.template",
  "utf8",
);
for (const id of ids) {
  const dir = builds + "/" + id;
  const manifest = JSON.parse(await readFile(dir + "/manifest.json"));
  const wasm = await readFile(dir + "/nexora_wasm_bg.wasm");
  if (hash(wasm) !== manifest.wasmSHA256) throw Error("changed binary");
  data[id] = {
    manifest,
    wasm,
    js: await readFile(dir + "/nexora_wasm.js"),
    wrapper: template
      .replaceAll(
        "__CORE__",
        JSON.stringify("/binary/" + id + "/nexora_wasm.js"),
      )
      .replaceAll("__BUILD_ID__", JSON.stringify(id)),
  };
}
const fixtures = [
  ["wave-1024", "curve-optimization/wave-1024", 1024],
  ["rounded-1024", "acute-geometry/rounded-blade-native-srgb-1024", 1024],
  ["triangle-512", "acute-geometry/triangle-eight-native-srgb-512", 512],
  ["wave-128", "curve-optimization/wave-128", 128],
];
const server = createServer((req, res) => {
  const parts = req.url.split("/"),
    id = parts[2];
  res.setHeader("Cache-Control", "no-store");
  if (req.url === "/") {
    res.end("<body>Dispatch isolation</body>");
    return;
  }
  if (!data[id]) {
    res.writeHead(404).end();
    return;
  }
  if (parts[1] === "module") {
    res.setHeader("Content-Type", "text/javascript");
    res.end(data[id].wrapper);
  } else {
    res.setHeader(
      "Content-Type",
      parts[3]?.endsWith(".wasm") ? "application/wasm" : "text/javascript",
    );
    res.end(parts[3]?.endsWith(".wasm") ? data[id].wasm : data[id].js);
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = "http://127.0.0.1:" + server.address().port,
  rows = [];
await writeFile(
  root + "/protocol.json",
  JSON.stringify(
    {
      builds: Object.fromEntries(ids.map((id) => [id, data[id].manifest])),
      sessions: 3,
      aaSlots: 2,
      callsPerRealm: 6,
      flags: process.env.NEXORA_DISPATCH_JS_FLAGS ?? "default",
      factor:
        "setTimeout(0) task yield only; no other change to ordered trace calls",
      policy:
        "CPU is group-envelope only; per-call thread CPU is not inferred. All observations retained.",
    },
    null,
    2,
  ),
);
try {
  for (let rep = 0; rep < 3; rep++) {
    const browser = await chromium.launch({
      executablePath: process.env.NEXORA_CHROMIUM_PATH,
      args: process.env.NEXORA_DISPATCH_JS_FLAGS
        ? ["--js-flags=" + process.env.NEXORA_DISPATCH_JS_FLAGS]
        : [],
    });
    const cdp = await browser.newBrowserCDPSession();
    await writeFile(
      root + `/categories-${rep}.json`,
      JSON.stringify(await cdp.send("Tracing.getCategories")),
    );
    let writes = Promise.resolve();
    cdp.on("Tracing.dataCollected", (e) => {
      writes = writes.then(() =>
        appendFile(
          root + `/traces/session-${rep}.jsonl`,
          e.value.map((e) => JSON.stringify(e)).join("\n") + "\n",
        ),
      );
    });
    await cdp.send("Tracing.start", {
      categories:
        "v8,disabled-by-default-v8.wasm,devtools.timeline,blink.user_timing",
      transferMode: "ReportEvents",
    });
    try {
      for (const [key, path, size] of rep % 2
        ? [...fixtures].reverse()
        : fixtures) {
        const png = await readFile("tests/fixtures/" + path + ".png"),
          bytes = await sharp(png).ensureAlpha().raw().toBuffer();
        for (const id of rep % 2 ? [...ids].reverse() : ids)
          for (const slot of [0, 1])
            for (const yielded of (rep + slot) % 2
              ? [true, false]
              : [false, true]) {
              const context = await browser.newContext();
              const page = await context.newPage();
              page.setDefaultTimeout(180000);
              await page.goto(origin);
              const init = await page.evaluate(
                async ({ id, bytes }) => {
                  window.m = await import("/module/" + id);
                  const t = performance.now();
                  await window.m.default();
                  window.bytes = Uint8Array.from(atob(bytes), (c) =>
                    c.charCodeAt(0),
                  );
                  return performance.now() - t;
                },
                { id, bytes: bytes.toString("base64") },
              );
              const before = await snapshot(cdp);
              const packets = await page.evaluate(
                async ({ yielded, size }) => {
                  const pending = [];
                  for (let i = 0; i < 6; i++) {
                    window.m.trace_quality(
                      window.bytes,
                      size,
                      size,
                      "illustration",
                      "inverse-reduce-reconstruct",
                    );
                    pending.push(window.m.telemetry());
                    if (yielded && i < 5)
                      await new Promise((r) => setTimeout(r, 0));
                  }
                  return Promise.all(pending);
                },
                { yielded, size },
              );
              const after = await snapshot(cdp);
              const group = {
                rep,
                fixture: key,
                id,
                slot,
                yielded,
                initMs: init,
                sourceSHA256: hash(png),
                rgbaSHA256: hash(bytes),
                binary: data[id].manifest,
                cpu: deltaCPU(before, after),
                packets: packets.map(({ svg, ...p }) => p),
              };
              rows.push(group);
              await appendFile(
                root + "/observations.jsonl",
                JSON.stringify(group) + "\n",
              );
              await context.close();
            }
        console.log(rep, key, rows.length);
      }
    } finally {
      const done = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
      await cdp.send("Tracing.end");
      await done;
      await writes;
      await browser.close();
    }
  }
  const summary = [];
  const failures = [];
  for (const [key] of fixtures) {
    const rs = rows.filter((r) => r.fixture === key);
    if (
      new Set(rs.flatMap((r) => r.packets.map((p) => p.svgSHA256))).size !== 1
    )
      failures.push(key + " SVG differs");
    if (rs.some((r) => r.packets.some((p) => p.rgbaSHA256 !== r.rgbaSHA256)))
      failures.push(key + " source differs");
    for (const id of ids)
      for (const yielded of [false, true]) {
        const r = rs.filter((r) => r.id === id && r.yielded === yielded);
        summary.push({
          fixture: key,
          id,
          yielded,
          first: distribution(r.map((r) => r.packets[0].coreMs)),
          warm: distribution(
            r.flatMap((r) => r.packets.slice(1).map((p) => p.coreMs)),
          ),
          sessions: [0, 1, 2].map((rep) =>
            distribution(
              r
                .filter((r) => r.rep === rep)
                .flatMap((r) => r.packets.slice(1).map((p) => p.coreMs)),
            ),
          ),
        });
      }
  }
  await writeFile(
    root + "/summary.json",
    JSON.stringify({ failures, summary }, null, 2),
  );
  if (failures.length) process.exitCode = 1;
} finally {
  await new Promise((r) => server.close(r));
}
