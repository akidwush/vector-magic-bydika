import { chromium } from "@playwright/test";
import { readFile, readdir } from "node:fs/promises";
import sharp from "sharp";
const folder = (await readdir("test-results")).find((n) =>
  n.startsWith("stage12-production"),
);
if (!folder) throw new Error("Run stage12 browser test first");
const browser = await chromium.launch({
  executablePath: process.env.NEXORA_CHROMIUM_PATH,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 700 },
  });
  for (const file of [
    "quality/cat-128-opaque.png",
    "stage12/cat-128-blended.png",
    "stage12/cat-128-lossy.webp",
  ]) {
    const original = await sharp("tests/fixtures/" + file)
      .png()
      .toBuffer();
    const key = file.replaceAll("/", "-");
    const images = [
      ["Source", original, "image/png"],
      [
        "Stage 1.1",
        await readFile(`test-results/${folder}/${key}-legacy.svg`),
        "image/svg+xml",
      ],
      [
        "Stage 1.2",
        await readFile(`test-results/${folder}/${key}-auto.svg`),
        "image/svg+xml",
      ],
    ];
    for (const zoom of [1, 4]) {
      await page.setContent(
        `<body style="font:16px sans-serif;background:#ddd"><h1>${file} · same input/scale · ${zoom * 100}%</h1><div style="display:flex;gap:10px">${images.map(([label, data, mime]) => `<figure style="margin:0"><figcaption>${label}</figcaption><img width="${128 * zoom}" height="${128 * zoom}" src="data:${mime};base64,${data.toString("base64")}"></figure>`).join("")}</div></body>`,
      );
      await page
        .locator("img")
        .evaluateAll((images) => Promise.all(images.map((i) => i.decode())));
      await page.screenshot({
        path: `benchmark-results/stage12/${key}-${zoom * 100}.png`,
      });
    }
  }
} finally {
  await browser.close();
}
