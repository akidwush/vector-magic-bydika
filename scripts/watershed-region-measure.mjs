// Exact exported bytes; reuse an offline score only for identical full dependencies.
import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { chromium } from "@playwright/test";
import { compareRaster, svgComplexity } from "./real-artwork-metrics.mjs";
const root = resolve(process.env.NEXORA_ART_ROOT),
  fixtures = process.env.NEXORA_ART_FIXTURES ?? "tests/fixtures/real-artwork",
  out = process.env.NEXORA_WATERSHED_MEASURE ?? root + "/source-measure";
await mkdir(out);
const sha = (b) => createHash("sha256").update(b).digest("hex"),
  corpus = JSON.parse(await readFile(fixtures + "/manifest.json")),
  rows = (await readFile(root + "/conversions.jsonl", "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse),
  cache = new Map(),
  results = [];
const browser = await chromium.launch({
    executablePath: process.env.NEXORA_CHROMIUM_PATH,
  }),
  page = await browser.newPage();
try {
  for (const r of rows) {
    if (r.status !== "EXPORTED") continue;
    const item = corpus.images.find((x) => x.id === r.image),
      file = await readFile(fixtures + "/" + item.image),
      svg = await readFile(root + "/" + r.runs[0].export, "utf8");
    if (
      sha(file) !== item.imageSHA256 ||
      sha(Buffer.from(svg)) !== r.runs[0].svgSHA256
    )
      throw Error("Artifact hash mismatch");
    const key = JSON.stringify([
        item.imageSHA256,
        r.runs[0].svgSHA256,
        item.width,
        item.height,
        item.background,
        item.maskApplicable,
      ]),
      cached = cache.get(key);
    let scores = cached;
    if (!scores) {
      const src = await sharp(file).ensureAlpha().raw().toBuffer(),
        vips = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer(),
        bytes = await page.evaluate(
          async ({ svg, w, h }) => {
            const i = new Image();
            i.src =
              "data:image/svg+xml;base64," +
              btoa(unescape(encodeURIComponent(svg)));
            await i.decode();
            const c = document.createElement("canvas");
            c.width = w;
            c.height = h;
            c.getContext("2d").drawImage(i, 0, 0, w, h);
            return Array.from(c.getContext("2d").getImageData(0, 0, w, h).data);
          },
          { svg, w: item.width, h: item.height },
        );
      const a = compareRaster(src, vips, item.width, item.height, {
          background: item.background,
          maskApplicable: item.maskApplicable,
        }),
        b = compareRaster(src, Buffer.from(bytes), item.width, item.height, {
          background: item.background,
          maskApplicable: item.maskApplicable,
        });
      delete a.heat;
      delete b.heat;
      scores = { libvips: a, chromium: b, complexity: svgComplexity(svg) };
      cache.set(key, scores);
    }
    const metric = {
      id: r.id,
      image: r.image,
      config: r.config.id,
      ...scores,
      scoreReusedForIdenticalDependencies: !!cached,
      sourceSHA256: item.imageSHA256,
      svgSHA256: r.runs[0].svgSHA256,
      runs: r.runs.map((x) => ({ state: x.state, ...x.perf })),
      research: r.worker.regionResearch?.map((x) => x.watershed) ?? [],
    };
    await writeFile(
      out + "/" + r.id + ".json",
      JSON.stringify(metric, null, 2),
    );
    await appendFile(
      out + "/measurements.jsonl",
      JSON.stringify(metric) + "\n",
    );
    results.push(metric);
    console.log(
      JSON.stringify({
        id: r.id,
        vips: metric.libvips.mae,
        chrome: metric.chromium.mae,
        paths: metric.complexity.paths,
        verdict: metric.research[0]?.verdict,
      }),
    );
  }
  await writeFile(
    out + "/summary.json",
    JSON.stringify(
      {
        images: results.length,
        independentlyRasterizedUniqueDependencies: cache.size,
        policy:
          "Original raster reconstruction; source and actual download hashes verified. Identical SVG/source/dimension/mask/background dependencies reuse immutable offline scores. No true-original-vector accuracy claim.",
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
