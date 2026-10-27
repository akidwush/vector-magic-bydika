// Offline evaluation phase: references are read only after all conversions finish.
import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";
import sharp from "sharp";
import { contour } from "./real-artwork-contours.mjs";
import {
  compareRaster,
  svgComplexity,
  sampledBoundary,
  classify,
  foreground,
} from "./real-artwork-metrics.mjs";
import { cornerMetrics } from "./source-structure-metrics.mjs";
import { geometry } from "./curve-geometry-metrics.mjs";
const exec = promisify(execFile),
  hash = (b) => createHash("sha256").update(b).digest("hex");
const root = resolve(process.env.NEXORA_ART_ROOT),
  fixtures = resolve("tests/fixtures/real-artwork");
await mkdir(root + "/protocol", { recursive: true });
for (const name of [
  "real-artwork-analyze.mjs",
  "real-artwork-metrics.mjs",
  "real-artwork-contours.mjs",
])
  await writeFile(
    root + "/protocol/" + name,
    await readFile("scripts/" + name),
  );
await mkdir(root + "/analysis");
await mkdir(root + "/crops");
await mkdir(root + "/references");
await mkdir(root + "/roundtrip");
const corpus = JSON.parse(await readFile(fixtures + "/manifest.json")),
  conversions = (await readFile(root + "/conversions.jsonl", "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
const conversionPlan = JSON.parse(await readFile(root + "/plan.json"));
if (
  hash(await readFile(fixtures + "/manifest.json")) !==
  conversionPlan.corpusSHA256
)
  throw Error("Frozen corpus changed");
const sizeSvg = (s, w, h) =>
  s.replace(/<svg\b[^>]*>/, (t) =>
    t
      .replace(/\s(?:width|height)="[^"]*"/g, "")
      .replace("<svg", `<svg width="${w}" height="${h}"`),
  );
const raw = (svg, w, h, scale = 1) =>
  sharp(Buffer.from(sizeSvg(svg, w * scale, h * scale)))
    .ensureAlpha()
    .raw()
    .toBuffer();
const browser = await chromium.launch({
  executablePath: process.env.NEXORA_CHROMIUM_PATH,
});
const page = await browser.newPage();
const measured = [],
  failures = [];
async function chromePng(svg, w, h) {
  return Buffer.from(
    await page.evaluate(
      async ({ svg, w, h }) => {
        const image = new Image();
        image.src =
          "data:image/svg+xml;base64," +
          btoa(unescape(encodeURIComponent(svg)));
        await image.decode();
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        c.getContext("2d").drawImage(image, 0, 0, w, h);
        return c.toDataURL("image/png").split(",")[1];
      },
      { svg, w, h },
    ),
    "base64",
  );
}
const normalized = new Map();
async function reference(item) {
  if (!item.reference) return null;
  let svg = await readFile(fixtures + "/" + item.reference, "utf8");
  if (item.variant === "low-contrast")
    svg = svg.replace(
      /#[0-9a-f]{6}/gi,
      (s) =>
        "#" +
        [1, 3, 5]
          .map((i) =>
            Math.round(255 * 0.82 + parseInt(s.slice(i, i + 2), 16) * 0.18)
              .toString(16)
              .padStart(2, "0"),
          )
          .join(""),
    );
  if (item.variant === "partial")
    svg = svg
      .replace(/(<svg[^>]*>)/, '$1<g opacity="0.68">')
      .replace("</svg>", "</g></svg>");
  const key = hash(Buffer.from(svg));
  if (!normalized.has(key)) {
    const input = root + "/references/" + key + "-input.svg",
      out = root + "/references/" + key + "-outline.svg";
    await writeFile(input, svg);
    const result = await exec(
      "inkscape",
      [
        input,
        "--export-plain-svg",
        "--export-filename=" + out,
        "--actions=select-all:all;object-to-path;object-stroke-to-path;export-do",
      ],
      {
        timeout: 30000,
        env: { ...process.env, XDG_CACHE_HOME: "/tmp/nexora-artwork-cache" },
      },
    );
    await writeFile(
      root + "/references/" + key + ".log",
      result.stdout + result.stderr,
    );
    normalized.set(key, await readFile(out, "utf8"));
  }
  const outline = normalized.get(key);
  const native = await raw(svg, item.width, item.height),
    outlined = await raw(outline, item.width, item.height);
  const normalization = compareRaster(
    native,
    outlined,
    item.width,
    item.height,
    { maskApplicable: false },
  ).mae;
  if (normalization > 0.5)
    return {
      status: "UNSUPPORTED",
      reason: "Reference outline normalization changed rendering",
      normalizationMae: normalization,
    };
  const pixels = await raw(outline, item.width, item.height, 2),
    mask = foreground(pixels, item.background);
  const points = await contour(page, outline, item.width, item.height, mask);
  return {
    status: "AVAILABLE",
    ...points,
    normalizationMae: normalization,
    hash: key,
  };
}
async function screenshot(item, row, source, svg, metric, heat) {
  const [x, y, bw, bh] = metric.worst[0].box;
  const labels = [
    "Source raster",
    "Actual exported SVG",
    "Premultiplied RGBA difference x12",
  ];
  const heatPng = await sharp(heat, {
    raw: { width: item.width, height: item.height, channels: 4 },
  })
    .png()
    .toBuffer();
  const data = [
    "data:" + item.mime + ";base64," + source.toString("base64"),
    "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64"),
    "data:image/png;base64," + heatPng.toString("base64"),
  ];
  const allZoom = [
    "original-anime-128",
    "original-small-symbols-128",
    "original-anime-512-partial",
    "twemoji-fox-128-jpeg",
    "original-garden-512-low-contrast",
    "kenney-city-512",
    "twemoji-bicycle-512",
    "original-ribbon-128",
  ].includes(item.id);
  const files = [];
  for (const zoom of allZoom ? [1, 4, 10] : [1]) {
    const html = `<style>body{margin:12px;font:12px sans-serif;background:white}.row{display:flex;gap:12px}.crop{width:${bw * zoom}px;height:${bh * zoom}px;overflow:hidden;position:relative;background:repeating-conic-gradient(#ddd 0% 25%,white 0% 50%) 0/12px 12px}.crop img{position:absolute;left:${-x * zoom}px;top:${-y * zoom}px;width:${item.width * zoom}px;height:${item.height * zoom}px}p{margin:0 0 8px}</style><p>${row.id} | crop ${x},${y},${bw},${bh} | ${zoom * 100}% | local MAE ${metric.worst[0].mae.toFixed(3)}</p><div class="row">${data.map((src, i) => `<div><p>${labels[i]}</p><div class="crop"><img style="${i === 1 ? "" : "image-rendering:pixelated"}" src="${src}"/></div></div>`).join("")}</div>`;
    await page.setContent(html);
    await page.evaluate(() =>
      Promise.all([...document.images].map((i) => i.decode())),
    );
    await page.setViewportSize({
      width: Math.max(700, bw * zoom * 3 + 60),
      height: Math.max(160, bh * zoom + 80),
    });
    const file = "crops/" + row.id + "-" + zoom * 100 + ".png";
    await page.screenshot({ path: root + "/" + file });
    files.push(file);
  }
  return files;
}
try {
  for (const item of corpus.images.filter((item) =>
    conversions.some((r) => r.image === item.id),
  )) {
    const source = await readFile(fixtures + "/" + item.image),
      src = await sharp(source).ensureAlpha().raw().toBuffer();
    let ref;
    try {
      ref = await reference(item);
    } catch (e) {
      ref = { status: "UNSUPPORTED", reason: String(e) };
    }
    for (const conversion of conversions.filter((r) => r.image === item.id)) {
      const row = {
        id: conversion.id,
        image: item.id,
        family: item.family,
        category: item.category,
        split: item.split,
        config: conversion.config,
        reference: item.reference,
        referenceStatus: item.referenceStatus,
        status: conversion.status,
      };
      if (conversion.status !== "EXPORTED") {
        row.error = conversion.error;
        measured.push(row);
        continue;
      }
      try {
        const svg = await readFile(
          root + "/" + conversion.runs[0].export,
          "utf8",
        );
        const vips = await raw(svg, item.width, item.height);
        const options = {
          background: item.background,
          maskApplicable: item.maskApplicable !== false,
          rois: item.rois,
        };
        const vr = compareRaster(src, vips, item.width, item.height, options);
        const png = await chromePng(svg, item.width, item.height);
        await writeFile(root + "/analysis/" + row.id + "-chromium.png", png);
        const cr = compareRaster(
          src,
          await sharp(png).ensureAlpha().raw().toBuffer(),
          item.width,
          item.height,
          options,
        );
        const complexity = svgComplexity(svg);
        let boundary = {
          status: item.reference ? "UNSUPPORTED" : "NOT_APPLICABLE",
          reason: ref?.reason ?? "No vector reference",
        };
        if (ref?.status === "AVAILABLE") {
          const outputMask = foreground(
            await raw(svg, item.width, item.height, 2),
            item.background,
          );
          const output = await contour(
            page,
            svg,
            item.width,
            item.height,
            outputMask,
          );
          boundary = {
            ...sampledBoundary(ref.points, output.points),
            version: 2,
            referenceFrameSamples: ref.framePoints,
            outputFrameSamples: output.framePoints,
            referenceEndpoints: ref.endpoints,
            outputEndpoints: output.endpoints,
            normalizationMae: ref.normalizationMae,
          };
        }
        const heat = vr.heat;
        delete vr.heat;
        delete cr.heat;
        Object.assign(row, {
          status: "MEASURED",
          libvips: vr,
          chromium: cr,
          complexity,
          boundary,
          corners: item.cornerReference
            ? cornerMetrics(geometry(svg), item.cornerReference)
            : null,
          flags: classify(vr, complexity),
          svgSHA256: conversion.runs[0].svgSHA256,
          runs: conversion.runs.map((r) => ({
            state: r.state,
            traceMs: r.perf.traceMs,
            startupMs: r.perf.startupMs,
            decodeMs: r.perf.decodeMs,
            workerMs: r.perf.workerTotalMs,
            clickToResultMs: r.clickToResultMs,
            linearBytes: r.perf.wasmLinearBytes,
            profile: r.perf.profile,
            refinement: r.perf.sourceRefinement,
            recovery: r.perf.sourceGeometry,
            sourceClass: r.perf.diagnostics?.classification,
            topology: r.perf.topology,
          })),
          crops: await screenshot(item, row, source, svg, vr, heat),
          export: conversion.runs[0].export,
        });
        if (conversion.config.id === "A-auto") {
          try {
            const out = root + "/roundtrip/" + item.id + ".svg",
              p = root + "/" + conversion.runs[0].export;
            const result = await exec(
              "inkscape",
              [p, "--export-plain-svg", "--export-filename=" + out],
              {
                timeout: 30000,
                env: {
                  ...process.env,
                  XDG_CACHE_HOME: "/tmp/nexora-artwork-cache",
                },
              },
            );
            await writeFile(
              root + "/roundtrip/" + item.id + ".log",
              result.stdout + result.stderr,
            );
            const rt = await readFile(out, "utf8");
            const rr = await raw(rt, item.width, item.height);
            row.inkscape = {
              status: /<image\b/.test(rt) ? "FAIL" : "IMPORTED",
              paintPaths: (rt.match(/<path\b/g) || []).length,
              roundtripMae: compareRaster(vips, rr, item.width, item.height, {
                maskApplicable: false,
              }).mae,
              file: "roundtrip/" + item.id + ".svg",
            };
          } catch (e) {
            row.inkscape = { status: "FAIL", error: String(e) };
            failures.push({ id: row.id, reason: "Inkscape import/export" });
          }
        }
        console.log(
          JSON.stringify({
            id: row.id,
            mae: vr.mae,
            local: vr.worst[0].mae,
            paths: complexity.paths,
            anchors: complexity.anchors,
            boundary: boundary.status,
            flags: row.flags.map((f) => f.code),
          }),
        );
      } catch (e) {
        row.status = "ANALYSIS_FAILED";
        row.error = String(e);
        failures.push({ id: row.id, reason: row.error });
      }
      measured.push(row);
      await appendFile(
        root + "/analysis/measurements.jsonl",
        JSON.stringify(row) + "\n",
      );
      await writeFile(
        root + "/analysis/" + row.id + ".json",
        JSON.stringify(row, null, 2),
      );
    }
  }
  await writeFile(
    root + "/analysis/summary.json",
    JSON.stringify(
      {
        status: failures.length ? "PARTIAL" : "MEASURED",
        rows: measured.length,
        failures,
        physicalAndroid: "PHYSICAL ANDROID — UNVERIFIED",
        policy:
          "No aggregate score implies geometric correctness. Flags are hypotheses pending visual review, not automatically assigned root causes.",
      },
      null,
      2,
    ),
  );
  if (failures.length) process.exitCode = 1;
} finally {
  await browser.close();
}
