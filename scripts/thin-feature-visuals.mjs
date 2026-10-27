// Fixed-view actual browser evidence. No geometry editing, redraw or fixture input to engine.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";
const root = process.env.NEXORA_THIN_EVALUATION,
  fixtures = process.env.NEXORA_ART_FIXTURES ?? "tests/fixtures/real-artwork";
if (!root) throw Error("Completed evaluation required");
const out = process.env.NEXORA_THIN_VISUAL_ROOT ?? root + "/thin-visuals";
await mkdir(out);
const rows = (await readFile(root + "/analysis/measurements.jsonl", "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse),
  manifest = JSON.parse(await readFile(fixtures + "/manifest.json"));
const roiOverrides = process.env.NEXORA_THIN_VISUAL_ROIS_FILE
  ? JSON.parse(await readFile(process.env.NEXORA_THIN_VISUAL_ROIS_FILE))
  : {};
const ids = (
  process.env.NEXORA_THIN_VISUAL_IMAGES ??
  "original-small-symbols-128,original-small-symbols-512,original-signage-128,original-garden-512-low-contrast,original-anime-128,circuit-ribbon-128,stencil-kite-128,ribbon-garden-128"
).split(",");
const sha = (b) => createHash("sha256").update(b).digest("hex"),
  browser = await chromium.launch({
    executablePath: process.env.NEXORA_CHROMIUM_PATH,
  }),
  page = await browser.newPage(),
  evidence = [];
try {
  for (const id of ids) {
    const item = manifest.images.find((r) => r.id === id),
      b = rows.find(
        (r) =>
          r.image === id &&
          r.config.id === (process.env.NEXORA_THIN_BASELINE_ID ?? "A-auto"),
      ),
      c = rows.find(
        (r) =>
          r.image === id &&
          r.config.id ===
            (process.env.NEXORA_THIN_CANDIDATE_ID ?? "thin-structural"),
      );
    if (!b || !c) throw Error("Missing measured SVG " + id);
    const source = await readFile(fixtures + "/" + item.image),
      base = await readFile(root + "/" + b.export),
      candidate = await readFile(root + "/" + c.export);
    if (
      sha(source) !== item.imageSHA256 ||
      sha(base) !== b.svgSHA256 ||
      sha(candidate) !== c.svgSHA256
    )
      throw Error("Evidence identity mismatch");
    const data = [
      "data:" + item.mime + ";base64," + source.toString("base64"),
      "data:image/svg+xml;base64," + base.toString("base64"),
      "data:image/svg+xml;base64," + candidate.toString("base64"),
    ];
    const center = roiOverrides[id]?.center ?? [
      b.libvips.worst[0].box[0] + b.libvips.worst[0].box[2] / 2,
      b.libvips.worst[0].box[1] + b.libvips.worst[0].box[3] / 2,
    ];
    for (const zoom of [1, 4, 10]) {
      const w = zoom === 1 ? item.width : 256,
        h = zoom === 1 ? item.height : 256;
      await page.setViewportSize({ width: 3 * w + 56, height: h + 128 });
      await page.setContent(
        `<style>body{font:13px sans-serif;background:#e9e9ec;margin:12px;color:#151522}main{display:flex;gap:12px}.view{position:relative;overflow:hidden;background:white;width:${w}px;height:${h}px;outline:1px solid #aaa}.view img{position:absolute;width:${item.width * zoom}px;height:${item.height * zoom}px;left:${zoom === 1 ? 0 : w / 2 - center[0] * zoom}px;top:${zoom === 1 ? 0 : h / 2 - center[1] * zoom}px}section:first-child img{image-rendering:pixelated}h1{font-size:16px}p{margin:4px 0 8px}</style><h1>${id} · ${zoom * 100}% · ${item.width}×${item.height}</h1><p>Same viewport and source coordinates. Zoom center from recorded baseline tile or source-support ROI; source pixels shown without interpolation.</p><main>${data.map((src, i) => `<section><p>${["Original raster", b.config.id + " · " + b.config.quality + " download", c.config.id + " · " + c.config.quality + " download"][i]}</p><div class="view"><img src="${src}"></div></section>`).join("")}</main>`,
      );
      await page
        .locator("img")
        .evaluateAll(async (imgs) => Promise.all(imgs.map((i) => i.decode())));
      const name = id + "-" + zoom * 100 + ".png";
      await page.screenshot({ path: out + "/" + name });
      evidence.push({
        image: id,
        zoom: zoom * 100,
        file: name,
        center: zoom === 1 ? null : center,
        sourceSHA256: sha(source),
        baselineSVG: b.svgSHA256,
        candidateSVG: c.svgSHA256,
        policy:
          "Unedited browser screenshot; same source coordinates, viewport and scale for all three columns.",
      });
    }
  }
} finally {
  await browser.close();
}
await writeFile(out + "/manifest.json", JSON.stringify(evidence, null, 2));
console.log({ screenshots: evidence.length });
