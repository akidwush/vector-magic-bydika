// Named detail crops and full-image comparison, from untouched downloaded SVGs.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { geometry } from "./curve-geometry-metrics.mjs";
const root = resolve(process.env.NEXORA_ART_ROOT),
  corpus = JSON.parse(
    await readFile("tests/fixtures/real-artwork/manifest.json"),
  ),
  rows = (
    await readFile(
      (process.env.NEXORA_ART_REPORT_ROOT ?? root) +
        "/enriched-measurements.jsonl",
      "utf8",
    )
  )
    .trim()
    .split("\n")
    .map(JSON.parse);
const gallery = process.env.NEXORA_ART_GALLERY_ROOT ?? root + "/gallery";
await mkdir(gallery);
const selected = [
  "twemoji-unicorn-512",
  "twemoji-woman-512",
  "original-anime-128",
  "original-anime-side-512",
  "original-small-symbols-128",
  "original-anime-512-webp",
  "original-anime-512-partial",
  "twemoji-fox-128-jpeg",
  "original-garden-512-low-contrast",
  "kenney-city-512",
];
const browser = await chromium.launch({
    executablePath: process.env.NEXORA_CHROMIUM_PATH,
  }),
  page = await browser.newPage();
const index = [];
try {
  for (const id of selected) {
    const item = corpus.images.find((r) => r.id === id);
    const variants = [];
    variants.push({
      label: "Original raster",
      src:
        "data:" +
        item.mime +
        ";base64," +
        (await readFile("tests/fixtures/real-artwork/" + item.image)).toString(
          "base64",
        ),
      pixel: true,
    });
    for (const config of ["A-auto", "B-vtracer-legacy", "C-geometry-f"]) {
      const row = rows.find((r) => r.image === id && r.config.id === config);
      if (row?.status !== "MEASURED") continue;
      const svg = await readFile(row.evidenceRoot + "/" + row.export, "utf8");
      variants.push({
        label: `${config} | ${row.complexity.anchors} anchors | ${row.complexity.paths} paths | RGBA ${row.libvips.mae.toFixed(2)}`,
        src: "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64"),
        pixel: false,
        svg,
      });
    }
    const originalCrop =
      item.rois[0]?.box ??
      rows.find((r) => r.image === id && r.config.id === "A-auto").libvips
        .worst[0].box;
    const crop = [
      originalCrop[0],
      originalCrop[1],
      Math.min(128, originalCrop[2]),
      Math.min(128, originalCrop[3]),
    ];
    const geo = rows.find((r) => r.image === id && r.config.id === "A-auto")
      .boundary?.worstPoint?.point;
    const selections = [
      ["full", [0, 0, item.width, item.height], [1]],
      ["detail", crop, [1, 4, 10]],
    ];
    if (geo)
      selections.push([
        "geometry",
        [
          Math.max(0, Math.min(item.width - 24, Math.floor(geo[0] - 12))),
          Math.max(0, Math.min(item.height - 24, Math.floor(geo[1] - 12))),
          24,
          24,
        ],
        [1, 4, 10],
      ]);
    for (const [kind, box, zooms] of selections)
      for (const zoom of zooms) {
        const [x, y, w, h] = box;
        const html = `<style>body{margin:12px;font:11px sans-serif;background:white}.row{display:flex;gap:12px}.crop{width:${w * zoom}px;height:${h * zoom}px;overflow:hidden;position:relative;background:repeating-conic-gradient(#ddd 0% 25%,white 0% 50%) 0/12px 12px}.crop img{position:absolute;left:${-x * zoom}px;top:${-y * zoom}px;width:${item.width * zoom}px;height:${item.height * zoom}px}p{margin:0 0 6px}</style><p>${id} | ${kind} ${zoom * 100}% | D is byte-identical to C in this corpus | ${item.license}</p><div class="row">${variants.map((v) => `<div><p>${v.label}</p><div class="crop"><img src="${v.src}" style="${v.pixel ? "image-rendering:pixelated" : ""}"/></div></div>`).join("")}</div>`;
        await page.setContent(html);
        await page.evaluate(() =>
          Promise.all([...document.images].map((i) => i.decode())),
        );
        await page.setViewportSize({
          width: Math.max(1000, w * zoom * variants.length + 70),
          height: Math.max(180, h * zoom + 85),
        });
        const file = `${id}-${kind}-${zoom * 100}.png`;
        await page.screenshot({ path: gallery + "/" + file });
        index.push({ id, kind, zoom, file, box });
      }
    // Anchor overlay is diagnostic, not a manually edited conversion export.
    const row = rows.find((r) => r.image === id && r.config.id === "A-auto"),
      svg = await readFile(row.evidenceRoot + "/" + row.export, "utf8"),
      g = geometry(svg);
    const marks = g.paths
      .flatMap((p) =>
        p.edges.map(
          (e) =>
            `<circle cx="${e[0][0]}" cy="${e[0][1]}" r="0.6" fill="#ff00aa"/>`,
        ),
      )
      .join("");
    await writeFile(
      gallery + "/" + id + "-anchor-overlay.svg",
      svg.replace("</svg>", marks + "</svg>"),
    );
  }
  await writeFile(gallery + "/index.json", JSON.stringify(index, null, 2));
} finally {
  await browser.close();
}
