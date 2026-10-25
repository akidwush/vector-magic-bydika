// Offline export verification. Never executed by a conversion click.
import { chromium } from "@playwright/test";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { metrics } from "./quality-metrics.mjs";
const root = "benchmark-results/source-quality";
await mkdir(root, { recursive: true });
const rows = JSON.parse(
  await readFile("benchmark-results/stage13/production.json"),
);
const measuredGeometry = JSON.parse(
  await readFile("benchmark-results/stage13/geometry.json"),
);
const folder = (await readdir("test-results")).find((n) =>
  n.startsWith("corners-corner-fitting"),
);
const browser = await chromium.launch({
  executablePath: process.env.NEXORA_CHROMIUM_PATH,
});
try {
  const page = await browser.newPage();
  const evidence = [];
  for (const row of rows) {
    const sourcePath = row.name.startsWith("../")
      ? "tests/fixtures/" + row.name.slice(3)
      : "tests/fixtures/shared-edge/" + row.name;
    const mime = row.name.endsWith(".jpg")
      ? "image/jpeg"
      : row.name.endsWith(".webp")
        ? "image/webp"
        : "image/png";
    const images = [
      {
        label: "Original",
        url: `data:${mime};base64,${(await readFile(sourcePath)).toString("base64")}`,
      },
    ];
    for (const profile of ["pre-source", "auto"]) {
      const svg = await readFile(
        `test-results/${folder}/${row.name.replaceAll("/", "-")}-${profile}.svg`,
        "utf8",
      );
      images.push({
        label: profile === "auto" ? "Auto baru" : "Auto lama",
        url: "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64"),
      });
    }
    const rgba = await page.evaluate(
      async (images) =>
        Promise.all(
          images.map(async (item) => {
            const img = new Image();
            img.src = item.url;
            await img.decode();
            const c = document.createElement("canvas");
            c.width = c.height = 128;
            const ctx = c.getContext("2d");
            ctx.drawImage(img, 0, 0);
            return Array.from(ctx.getImageData(0, 0, 128, 128).data);
          }),
        ),
      images,
    );
    const old = row.variants.find((v) => v.profile === "pre-source"),
      current = row.variants.find((v) => v.profile === "auto");
    const browserOld = metrics(rgba[0], rgba[1], 128, 128),
      browserNew = metrics(rgba[0], rgba[2], 128, 128);
    const geometric = measuredGeometry.find((r) => r.name === row.name);
    const oldGeom = geometric.variants.find(
      (v) => v.profile === "pre-source",
    ).geometry;
    const newGeom = geometric.variants.find(
      (v) => v.profile === "auto",
    ).geometry;
    assert(
      newGeom.chamfer <= oldGeom.chamfer + 0.02,
      `${row.name}: mean geometric boundary regression`,
    );
    assert(
      newGeom.hausdorff95 <= oldGeom.hausdorff95 + 0.02,
      `${row.name}: p95 geometric boundary regression`,
    );
    // Both independent SVG rasterizers must avoid a material color/coverage regression.
    assert(
      current.quality.mae <= old.quality.mae + 0.03,
      `${row.name}: libvips raster regression`,
    );
    assert(
      browserNew.mae <= browserOld.mae + 0.05,
      `${row.name}: Chromium raster regression`,
    );
    if (row.name.includes("/circle.png") || row.name.includes("/oval.png"))
      assert(
        current.quality.mae < old.quality.mae * 0.8,
        `${row.name}: expected geometric model gain missing`,
      );
    if (row.name === "organic.png") {
      assert(
        current.quality.mae < old.quality.mae * 0.8,
        "organic silhouette improvement missing",
      );
      assert(
        current.detailIoU[0] >= 0.98 && current.detailIoU[1] >= 0.98,
        "round eye fidelity missing",
      );
      assert(
        current.detailIoU[2] >= old.detailIoU[2],
        "nose feature regressed",
      );
    }
    evidence.push({
      name: row.name,
      browserOld,
      browserNew,
      libvipsOld: old.quality,
      libvipsNew: current.quality,
    });
    if (
      ![
        "organic.png",
        "rings.png",
        "../coverage/circle.png",
        "../corners/star-128.png",
        "../corners/triangle-128.png",
      ].includes(row.name)
    )
      continue;
    for (const scale of [1, 4, 10]) {
      await page.setViewportSize({
        width: 3 * (128 * scale + 12) + 24,
        height: 128 * scale + 88,
      });
      await page.setContent(
        `<body style="margin:12px;background:#ddd;font:16px sans-serif"><h3 style="margin:0 0 8px">${row.name} — ${scale * 100}%</h3><div style="display:flex;gap:12px">${images.map((i) => `<figure style="margin:0"><figcaption>${i.label}</figcaption><img width="${128 * scale}" height="${128 * scale}" src="${i.url}"></figure>`).join("")}</div></body>`,
      );
      await page
        .locator("img")
        .evaluateAll((imgs) => Promise.all(imgs.map((i) => i.decode())));
      await page.screenshot({
        path: `${root}/${row.name.replaceAll("/", "-")}-${scale * 100}.png`,
        fullPage: true,
      });
    }
  }
  await writeFile(root + "/renderers.json", JSON.stringify(evidence, null, 2));
  console.log(
    `Verified old vs new Auto in Chromium and libvips for ${evidence.length} fixtures.`,
  );
} finally {
  await browser.close();
}
