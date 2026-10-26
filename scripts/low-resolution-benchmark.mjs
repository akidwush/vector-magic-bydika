// Actual browser WASM exports. References are measured outside the optimizer.
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import sharp from "sharp";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  geometry,
  chains,
  boundary,
  corners,
  worstBoundary,
} from "./curve-geometry-metrics.mjs";
import { structure, cornerMetrics } from "./source-structure-metrics.mjs";
import { metrics } from "./quality-metrics.mjs";

const root = resolve(
  process.env.NEXORA_PROOF_DIR || "benchmark-results/stage16c/browser-proof",
);
const stageD = process.env.NEXORA_COMPARE_STAGE === "16d";
const buildRoots = {
  [stageD ? "stage16c" : "stage16b"]: resolve(
    process.env.NEXORA_STAGE16B_WASM ||
      "benchmark-results/stage16c/baseline-wasm",
  ),
  candidate: resolve(process.env.NEXORA_CANDIDATE_WASM || "src/engine/wasm"),
};
await mkdir(root + "/low-resolution/exports", { recursive: true });
const server = createServer(async (req, res) => {
  if (req.url === "/") {
    res.end("<body></body>");
    return;
  }
  const [, key, file] = req.url.split("/");
  if (
    !buildRoots[key] ||
    !["nexora_wasm.js", "nexora_wasm_bg.wasm"].includes(file)
  ) {
    res.writeHead(404).end();
    return;
  }
  try {
    res.setHeader(
      "Content-Type",
      file.endsWith(".wasm") ? "application/wasm" : "text/javascript",
    );
    res.end(await readFile(buildRoots[key] + "/" + file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const browser = await chromium.launch({
  executablePath: process.env.NEXORA_CHROMIUM_PATH,
});
const uri = (s) =>
  "data:image/svg+xml;base64," + Buffer.from(s).toString("base64");
const core = ["cubic", "wave"].flatMap((name) =>
  [128, 512, 1024].map((size) => ({
    key: `${name}-${size}`,
    name,
    width: size,
    height: size,
    core: true,
    input: `tests/fixtures/curve-optimization/${name}-${size}.png`,
    reference: `tests/fixtures/curve-optimization/${name}.svg`,
  })),
);
const holdouts = JSON.parse(
  await readFile("tests/fixtures/acute-geometry/manifest.json"),
).map((r) => ({
  ...r,
  key: r.filename.replace(/\.png$/, ""),
  core: false,
  input: "tests/fixtures/acute-geometry/" + r.filename,
  reference: "tests/fixtures/acute-geometry/" + r.reference,
}));
const rows = [];
try {
  for (const entry of [...core, ...holdouts]) {
    // A fixture owns its module memories and screenshot DOM. Previous 1000%
    // previews and image heaps must not bias the next input's comparison.
    const page = await browser.newPage({ acceptDownloads: true });
    await page.goto(`http://127.0.0.1:${port}/`);
    const { width: w, height: h } = entry;
    const input = await readFile(entry.input);
    const source = await sharp(input).ensureAlpha().raw().toBuffer();
    const ref = geometry(await readFile(entry.reference, "utf8"));
    const reference = chains(ref).map((ps) =>
      ps.map((p) => p.map((v) => (v * w) / 256)),
    );
    const expected = corners(ref).map((p) => p.map((v) => (v * w) / 256));
    const variants = [],
      svgs = [];
    // Measure both engines back-to-back before Node performs reference geometry,
    // libvips rasterization or screenshot work. Interleave cold/warm runs so
    // the second engine is not timed against background scoring of the first.
    const results = await page.evaluate(
      async ({ keys, bytes, w, h }) => {
        const data = Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0));
        const modules = {},
          outputs = {},
          memories = {};
        for (const key of keys) {
          const m = await import("/" + key + "/nexora_wasm.js");
          const started = performance.now();
          const wasm = await m.default();
          modules[key] = m;
          memories[key] = wasm.memory;
          outputs[key] = {
            initMs: performance.now() - started,
            memoryBefore: wasm.memory?.buffer.byteLength,
            warmMs: [],
            warmStages: [],
          };
        }
        for (let round = 0; round < 3; round++) {
          for (const key of round === 1 ? [...keys].reverse() : keys) {
            const m = modules[key],
              record = outputs[key],
              started = performance.now();
            const svg = m.trace_quality(
              data,
              w,
              h,
              "illustration",
              "inverse-reduce-reconstruct",
            );
            const elapsed = performance.now() - started;
            const stages = [...m.last_stage_timings()];
            if (round === 0) {
              Object.assign(record, {
                svg,
                ms: elapsed,
                stages,
                inverse: [...m.last_inverse()],
                recovery: m.last_recovery ? [...m.last_recovery()] : [],
                continuity: m.last_continuity ? [...m.last_continuity()] : [],
                initialization: m.last_initialization
                  ? [...m.last_initialization()]
                  : [],
                acuteEvidence: m.last_acute_evidence
                  ? [...m.last_acute_evidence()]
                  : [],
              });
            } else {
              if (svg !== record.svg)
                throw Error("Non-deterministic warm geometry: " + key);
              record.warmMs.push(elapsed);
              record.warmStages.push(stages);
            }
          }
        }
        for (const key of keys) {
          outputs[key].autoSvg = modules[key].trace_quality(
            data,
            w,
            h,
            "illustration",
            "reduce-reconstruct",
          );
          outputs[key].memoryAfter = memories[key]?.buffer.byteLength;
        }
        return outputs;
      },
      { keys: Object.keys(buildRoots), bytes: source.toString("base64"), w, h },
    );
    for (const key of Object.keys(buildRoots)) {
      const result = results[key];
      const filename = entry.key + "-" + key + ".svg";
      const pending = page.waitForEvent("download");
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
        { svg: result.svg, filename },
      );
      await (
        await pending
      ).saveAs(root + "/low-resolution/exports/" + filename);
      const svg = await readFile(
        root + "/low-resolution/exports/" + filename,
        "utf8",
      );
      assert.equal(svg, result.svg);
      assert(
        !/<image|stroke=|<filter|shape-rendering/.test(svg),
        "Non-geometric output",
      );
      const g = geometry(svg);
      await writeFile(
        root + "/low-resolution/exports/" + entry.key + "-" + key + "-auto.svg",
        result.autoSvg,
      );
      const rgba = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer();
      variants.push({
        key,
        filename,
        ms: result.ms,
        initMs: result.initMs,
        warmMs: result.warmMs,
        stages: result.stages,
        inverse: result.inverse,
        warmStages: result.warmStages,
        recovery: result.recovery,
        continuity: result.continuity,
        initialization: result.initialization,
        acuteEvidence: result.acuteEvidence,
        memory: {
          beforeBytes: result.memoryBefore,
          afterBytes: result.memoryAfter,
          kind: "per-fixture WASM linear high-water allocation; not live heap or browser RSS",
        },
        geometry: boundary(reference, chains(g)),
        worst: worstBoundary(reference, chains(g)),
        structure: structure(g),
        cornerAccuracy: cornerMetrics(g, expected),
        anchors: g.anchors,
        curves: g.curves,
        paths: g.paths.length,
        bytes: g.bytes,
        autoHash: createHash("sha256").update(result.autoSvg).digest("hex"),
        raster: metrics(source, rgba, w, h, true),
      });
      svgs.push(svg);
    }
    const rasterUri = "data:image/png;base64," + input.toString("base64");
    const browserMetrics = await page.evaluate(
      async ({ urls, w, h, fn }) => {
        const measure = Function("return (" + fn + ")")();
        const data = [];
        for (const url of urls) {
          const im = new Image();
          im.src = url;
          await im.decode();
          const c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          const ctx = c.getContext("2d");
          ctx.drawImage(im, 0, 0, w, h);
          data.push(ctx.getImageData(0, 0, w, h).data);
        }
        return data.slice(1).map((b) => measure(data[0], b, w, h, true));
      },
      { urls: [rasterUri, ...svgs.map(uri)], w, h, fn: metrics.toString() },
    );
    variants.forEach((v, i) => (v.chromium = browserMetrics[i]));
    const unchanged = svgs[0] === svgs[1];
    // Each primary image has an equal-viewport export at all requested zooms.
    if (
      entry.core ||
      !unchanged ||
      (entry.name === "rounded-blade" && w === 128)
    ) {
      const point = variants[0].worst.point;
      for (const zoom of [1, 4, 10]) {
        const size = zoom === 1 ? w : Math.min(w, 48);
        const x =
          zoom === 1 ? 0 : Math.max(0, Math.min(w - size, point[0] - size / 2));
        const y =
          zoom === 1 ? 0 : Math.max(0, Math.min(h - size, point[1] - size / 2));
        const side = size * zoom;
        const bodies = [
          `<image href="${rasterUri}" width="${w}" height="${h}"/>`,
          ...svgs.map((s) =>
            s.replace(/^.*?<svg\b[^>]*>/s, "").replace(/<\/svg>\s*$/, ""),
          ),
        ];
        const images = bodies.map((body) =>
          uri(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" viewBox="${x} ${y} ${size} ${size}">${body}</svg>`,
          ),
        );
        await page.setViewportSize({
          width: 3 * (side + 12) + 24,
          height: side + 150,
        });
        await page.setContent(
          `<body style="margin:12px;background:#ddd;font:14px sans-serif"><b>${entry.key} | ${w}×${h} PNG | Illustration / VTracer WASM | ${zoom * 100}% | same ROI ${x},${y},${size}</b><div style="display:flex;gap:12px">${images.map((src, i) => `<figure style="margin:0"><figcaption style="height:64px">${(stageD ? ["Original Raster", "Stage 1.6C", "Stage 1.6D"] : ["Original Raster", "Stage 1.6B", "Stage 1.6C"])[i]}${i ? `<br>${variants[i - 1].anchors} anchors | ${variants[i - 1].curves} cubics | ${variants[i - 1].bytes} bytes<br>max ${variants[i - 1].geometry.max.toFixed(4)} px | ${variants[i - 1].ms.toFixed(1)} ms` : ""}</figcaption><img src="${src}" width="${side}" height="${side}"/></figure>`).join("")}</div></body>`,
        );
        await page
          .locator("img")
          .evaluateAll((images) => Promise.all(images.map((i) => i.decode())));
        await page.screenshot({
          path: `${root}/low-resolution/${entry.key}-${zoom * 100}.png`,
          fullPage: true,
        });
      }
    }
    rows.push({ ...entry, unchanged, variants });
    console.log(
      entry.key,
      variants.map((v) => ({
        build: v.key,
        error: v.geometry,
        ms: v.ms,
        init: v.recovery[24] || 0,
      })),
    );
    await page.close();
  }
  await writeFile(
    root + "/low-resolution/comparison.json",
    JSON.stringify(rows, null, 2),
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
