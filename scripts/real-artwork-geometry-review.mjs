// Versioned offline correction of geometric evaluation only. No engine reruns.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { chromium } from "@playwright/test";
import { contour } from "./real-artwork-contours.mjs";
import { foreground, sampledBoundary } from "./real-artwork-metrics.mjs";
const root = resolve(process.env.NEXORA_ART_ROOT),
  out = resolve(
    process.env.NEXORA_ART_GEOMETRY_OUT ?? root + "/geometry-review-v2",
  );
await mkdir(out);
const corpus = JSON.parse(
    await readFile("tests/fixtures/real-artwork/manifest.json"),
  ),
  rows = (await readFile(root + "/analysis/measurements.jsonl", "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
rows.forEach((r) => (r.dataRoot = root));
if (process.env.NEXORA_ART_SUPPLEMENT) {
  const other = resolve(process.env.NEXORA_ART_SUPPLEMENT);
  rows.push(
    ...(await readFile(other + "/analysis/measurements.jsonl", "utf8"))
      .trim()
      .split("\n")
      .map((s) => ({ ...JSON.parse(s), dataRoot: other })),
  );
}
const hash = (b) => createHash("sha256").update(b).digest("hex"),
  size = (s, w, h) =>
    s.replace(/<svg\b[^>]*>/, (t) =>
      t
        .replace(/\s(?:width|height)="[^"]*"/g, "")
        .replace("<svg", `<svg width="${w}" height="${h}"`),
    );
const browser = await chromium.launch({
    executablePath: process.env.NEXORA_CHROMIUM_PATH,
  }),
  page = await browser.newPage(),
  result = [];
await writeFile(
  out + "/plan.json",
  JSON.stringify(
    {
      version: 2,
      reason:
        "Correct omitted viewport clipping boundaries and canonical userSpaceOnUse opacity-mask geometry. Analytic identity/transform/mask/clip calibration required. No tracing or pixel-score changes.",
      helperSHA256: hash(await readFile("scripts/real-artwork-contours.mjs")),
      metricsSHA256: hash(await readFile("scripts/real-artwork-metrics.mjs")),
      rows: rows.length,
    },
    null,
    2,
  ),
);
try {
  for (const item of corpus.images) {
    const candidates = rows.filter(
      (r) => r.image === item.id && r.status === "MEASURED",
    );
    if (!item.reference || !candidates.length) continue;
    let source = await readFile(
      "tests/fixtures/real-artwork/" + item.reference,
      "utf8",
    );
    if (item.variant === "low-contrast")
      source = source.replace(
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
      source = source
        .replace(/(<svg[^>]*>)/, '$1<g opacity="0.68">')
        .replace("</svg>", "</g></svg>");
    const key = hash(source),
      normalized = await readFile(
        root + "/references/" + key + "-outline.svg",
        "utf8",
      );
    const get = async (svg) =>
      contour(
        page,
        svg,
        item.width,
        item.height,
        foreground(
          await sharp(Buffer.from(size(svg, item.width * 2, item.height * 2)))
            .ensureAlpha()
            .raw()
            .toBuffer(),
          item.background,
        ),
      );
    const reference = await get(normalized),
      cache = new Map();
    for (const row of candidates) {
      let boundary = cache.get(row.svgSHA256);
      if (!boundary) {
        const svg = await readFile(row.dataRoot + "/" + row.export, "utf8"),
          output = await get(svg);
        boundary = {
          ...sampledBoundary(reference.points, output.points),
          version: 2,
          referenceEndpoints: reference.endpoints,
          outputEndpoints: output.endpoints,
          referenceFrameSamples: reference.framePoints,
          outputFrameSamples: output.framePoints,
        };
        cache.set(row.svgSHA256, boundary);
      }
      result.push({ id: row.id, svgSHA256: row.svgSHA256, boundary });
    }
    console.log(item.id);
  }
  await writeFile(
    out + "/geometry.jsonl",
    result.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
} finally {
  await browser.close();
}
