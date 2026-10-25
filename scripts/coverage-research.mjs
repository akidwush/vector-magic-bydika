import { analyzeInput, chooseProfile } from "../src/engine/diagnostics.ts";
import { svgPoints } from "./stage12-svg-metrics.mjs";
import { paletteDenoise } from "./stage12-denoise.ts";
import { chromium } from "@playwright/test";
import sharp from "sharp";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { geometryMetrics } from "./stage12-metrics.mjs";
import { metrics } from "./quality-metrics.mjs";
const root = "benchmark-results/coverage";
await mkdir(root, { recursive: true });
const server = spawn("node", ["scripts/serve-dist.mjs"], {
  env: { ...process.env, NEXORA_RESEARCH: "1", NEXORA_PORT: "4195" },
  stdio: "ignore",
});
const browser = await chromium.launch({
  executablePath: process.env.NEXORA_CHROMIUM_PATH || "/usr/bin/chromium",
});
try {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      if ((await fetch("http://127.0.0.1:4195/nexora/")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  const page = await browser.newPage({
    viewport: { width: 1600, height: 700 },
  });
  await page.goto("http://127.0.0.1:4195/nexora/");
  const cases = process.argv.includes("--full")
    ? [
        "quality/cat-128-opaque.png",
        "quality/cat-512-opaque.png",
        "stage12/cat-128-blended.png",
        "stage12/cat-128-lossy.jpg",
        "stage12/cat-128-lossy.webp",
        "stage12/cat-512-blended.png",
        "stage12/cat-512-lossy.jpg",
        "stage12/cat-512-lossy.webp",
        "quality/cat-128-binary.png",
        "quality/cat-128-partial.png",
        "stage12/openmoji-cat-128.png",
        "stage12/openmoji-cat-512.png",
        "coverage/circle.png",
        "coverage/oval.png",
        "coverage/diagonal.png",
        "coverage/triangle.png",
        "coverage/pink.png",
        "coverage/edge-srgb.png",
        "coverage/edge-linear.png",
        "icon.png",
        "corners.png",
        "curves.png",
        "illustration.png",
        "illustration.webp",
        "lineart.png",
        "gradient.jpg",
        "transparent.png",
      ]
    : [
        "quality/cat-128-opaque.png",
        "stage12/cat-128-blended.png",
        "stage12/cat-128-lossy.webp",
        "stage12/openmoji-cat-128.png",
        "illustration.png",
        "illustration.webp",
        "lineart.png",
      ];
  const configs = [
    ["clean",60,4,0,false,false,128],
    ["coverage", 60, 4, 0, false, false, 128],
    ["denoise", 60, 4, 0, false, false, 128, false, 12],
    ["adaptive", 60, 4, 0, false, false, 128, true],
    ["baseline", 60, 4, 0, false, false, 128],
    ["corner90", 90, 4, 0, false, false, 128],
    ["corner120", 120, 4, 0, false, false, 128],
    ["corner180", 180, 4, 0, false, false, 128],
    ["length1", 60, 1, 0, false, false, 128],
    ["length2", 60, 2, 0, false, false, 128],
    ["smooth25", 60, 4, 0.25, false, false, 128],
    ["smooth50", 60, 4, 0.5, false, false, 128],
    ["smooth75", 60, 4, 0.75, false, false, 128],
    ["round", 120, 2, 0.25, false, false, 128],
    ["cutout", 90, 2, 0.25, true, false, 128],
    ["watershed96", 90, 2, 0.25, true, true, 96],
    ["watershed160", 90, 2, 0.25, true, true, 160],
  ];
  const results = [];
  for (const name of cases) {
    const bytes = await readFile("tests/fixtures/" + name);
    const meta = await sharp(bytes).metadata();
    const w = meta.width,
      h = meta.height;
    const src = await sharp(bytes).ensureAlpha().raw().toBuffer();
    const isCat = name.includes("cat-") && !name.includes("openmoji");
    const gt = isCat
      ? await sharp(`tests/fixtures/quality/cat-${w}-opaque.png`)
          .ensureAlpha()
          .raw()
          .toBuffer()
      : src;
    const chosen = process.argv.includes("--full")
      ? configs.filter(
          (c) =>
            c[0] === "baseline" ||
            c[0] === (process.env.NEXORA_CANDIDATE || "coverage"),
        )
      : configs;
    const diagnostic = analyzeInput({
      rgba: new Uint8ClampedArray(src),
      width: w,
      height: h,
      sourceFormat: `image/${meta.format}`,
    });
    const profile = chooseProfile(diagnostic, "illustration");
    for (const c of chosen) {
      const prepStart = performance.now();
      const prep = c[8]
        ? paletteDenoise(new Uint8ClampedArray(src), w, h, c[8])
        : { rgba: src, changedPixels: 0 };
      const prepMs = performance.now() - prepStart;
      const rgba = Buffer.from(prep.rgba).toString("base64");
      const r = await page.evaluate(
        async ({ rgba, w, h, c, profile }) => {
          const m = await import("/research/nexora_wasm.js");
          const core = await m.default();
          const data = Uint8Array.from(atob(rgba), (x) => x.charCodeAt(0)),
            precision = m.precision_for(data, "illustration"),
            start = performance.now();
          const mode =
            c[0] === "baseline"
              ? profile
              : c[0] === "coverage"
                ? `coverage-${profile}`
                : c[0] === "clean" ? `coverage-clean-${profile}` : c[0];
          const svg = ["baseline", "coverage", "clean", "adaptive", "denoise"].includes(c[0])
            ? m.trace_quality(data, w, h, "illustration", c[0] === "denoise" ? profile : mode)
            : m.experiment(data, w, h, precision, 2, 16, 24, "spline",
                c[4], c[5], c[1], c[2], c[3] || undefined, c[6], c[7]);
          return {
            svg,
            evidence: m.last_coverage_evidence(),
            ms: performance.now() - start,
            precision,
            wasmLinearBytes: core.memory.buffer.byteLength,
          };
        },
        { rgba, w, h, c, profile },
      );
      const output = await sharp(Buffer.from(r.svg))
        .ensureAlpha()
        .raw()
        .toBuffer();
      const measured = {
        ...metrics(
          src,
          output,
          w,
          h,
          !name.includes("partial") &&
            !name.includes("binary") &&
            !name.includes("transparent"),
        ),
        ...geometryMetrics(gt, output, w, h, isCat),
      };
      const id = name.replaceAll("/", "-") + "-" + c[0];
      await writeFile(`${root}/${id}.svg`, r.svg);
      await sharp(Buffer.from(r.svg)).png().toFile(`${root}/${id}.png`);
      await sharp(bytes).png().toFile(`${root}/${id}-source.png`);
      results.push({
        name,
        candidate: c[0],
        evidence: r.evidence,
        diagnostic,
        profile: c[0] === "policy" ? profile : "experiment",
        config: c,
        width: w,
        height: h,
        precision: r.precision,
        ms: r.ms,
        prepMs,
        changedPixels: prep.changedPixels,
        paths: (r.svg.match(/<path/g) || []).length,
        pathCommands: [...r.svg.matchAll(/ d="([^"]*)"/g)].reduce(
          (n, m) => n + (m[1].match(/[MmLlHhVvCcSsQqTtAaZz]/g) || []).length,
          0,
        ),
        bytes: Buffer.byteLength(r.svg),
        ...svgPoints(r.svg),
        wasmLinearBytes: r.wasmLinearBytes,
        ...measured,
      });
    }
    console.log(name, "done");
    await writeFile(`${root}/progress.json`, JSON.stringify(results, null, 2));
  }
  await writeFile(
    `${root}/${process.argv.includes("--full") ? "full" : "matrix"}.json`,
    JSON.stringify({ browser: browser.version(), results }, null, 2),
  );
} finally {
  await browser.close();
  server.kill();
}
