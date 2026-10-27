// Offline diagnostic only: inspect suspicious geometric outliers, no new trace.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";
import sharp from "sharp";
import { contour } from "./real-artwork-contours.mjs";
import { foreground, sampledBoundary } from "./real-artwork-metrics.mjs";
const root = process.env.NEXORA_ART_ROOT,
  diagnosis =
    process.env.NEXORA_ART_DIAG_OUT ?? root + "/metric-diagnosis-" + Date.now();
await mkdir(diagnosis);
const corpus = JSON.parse(
    await readFile("tests/fixtures/real-artwork/manifest.json"),
  ),
  browser = await chromium.launch({
    executablePath: process.env.NEXORA_CHROMIUM_PATH,
  }),
  page = await browser.newPage();
const size = (s, w, h) =>
  s.replace(/<svg\b[^>]*>/, (t) =>
    t
      .replace(/\s(?:width|height)="[^"]*"/g, "")
      .replace("<svg", `<svg width="${w}" height="${h}"`),
  );
try {
  for (const id of ["twemoji-unicorn-512", "original-anime-512-partial"]) {
    const item = corpus.images.find((r) => r.id === id);
    let original = await readFile(
      "tests/fixtures/real-artwork/" + item.reference,
      "utf8",
    );
    if (item.variant === "partial")
      original = original
        .replace(/(<svg[^>]*>)/, '$1<g opacity="0.68">')
        .replace("</svg>", "</g></svg>");
    const key = createHash("sha256").update(original).digest("hex"),
      reference = await readFile(
        root + "/references/" + key + "-outline.svg",
        "utf8",
      ),
      output = await readFile(
        root + "/exports/" + id + "--A-auto--first.svg",
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
    const ref = await get(reference),
      out = await get(output);
    const result = sampledBoundary(ref.points, out.points);
    await writeFile(
      diagnosis + "/" + id + ".json",
      JSON.stringify({ result, reference: ref, output: out }, null, 2),
    );
    console.log(id, result);
  }
} finally {
  await browser.close();
}
