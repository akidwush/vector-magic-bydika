import { chromium } from "@playwright/test";
import { readFile, readdir, mkdir } from "node:fs/promises";
import sharp from "sharp";
const dir = (await readdir("test-results")).find((n) =>
  n.startsWith("shared-edge-shared-graph"),
);
if (!dir) throw Error("Run the shared-edge browser suite first");
await mkdir("benchmark-results/shared-edge", { recursive: true });
const rows = JSON.parse(
  await readFile("benchmark-results/shared-edge/production.json"),
);
const browser = await chromium.launch({
  executablePath: process.env.NEXORA_CHROMIUM_PATH,
});
try {
  const page = await browser.newPage();
  for (const { name } of rows) {
    const source = await sharp("tests/fixtures/shared-edge/" + name)
      .png()
      .toBuffer();
    const images = [
      ["Original raster", source, "image/png"],
      [
        "Before: Stage 1.2 Auto",
        await readFile(`test-results/${dir}/${name}-auto.svg`),
        "image/svg+xml",
      ],
      [
        "After: locked shared graph",
        await readFile(`test-results/${dir}/${name}-planar.svg`),
        "image/svg+xml",
      ],
    ];
    for (const zoom of [1, 4, 10]) {
      await page.setViewportSize({
        width: Math.max(650, 128 * zoom * 3 + 48),
        height: 128 * zoom + 100,
      });
      await page.setContent(
        `<body style="margin:8px;font:16px sans-serif;background:#ccc"><h2>${name} — ${zoom * 100}% — same input and scale</h2><div style="display:flex;gap:8px">${images.map(([label, data, mime]) => `<figure style="margin:0"><figcaption>${label}</figcaption><img width="${128 * zoom}" height="${128 * zoom}" style="background:repeating-conic-gradient(#eee 0% 25%,white 0% 50%) 50%/16px 16px" src="data:${mime};base64,${data.toString("base64")}"></figure>`).join("")}</div></body>`,
      );
      await page
        .locator("img")
        .evaluateAll((imgs) => Promise.all(imgs.map((i) => i.decode())));
      await page.screenshot({
        path: `benchmark-results/shared-edge/${name}-${zoom * 100}.png`,
        fullPage: true,
      });
    }
  }
} finally {
  await browser.close();
}
