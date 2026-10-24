import { chromium } from "@playwright/test";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
const browser = await chromium.launch({
  executablePath: process.env.NEXORA_CHROMIUM_PATH || "/usr/bin/chromium",
});
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 700 },
  });
  const source = await sharp("tests/fixtures/quality/cat-128-opaque.png")
    .webp({ quality: 65 })
    .toBuffer();
  const prefix = "benchmark-results/quality/quality-cat-128-opaque.png-webp-";
  const images = [
    ["Original WebP", source, "image/webp"],
    [
      "Before: precision 7",
      await readFile(prefix + "baseline.svg"),
      "image/svg+xml",
    ],
    [
      "After: selected profile",
      await readFile(prefix + "selected.svg"),
      "image/svg+xml",
    ],
  ];
  for (const zoom of [1, 4]) {
    await page.setContent(
      `<body style="font:16px sans-serif;background:#ddd"><h1>Same input, same scale · ${zoom * 100}%</h1><div style="display:flex;gap:10px">${images.map(([title, data, mime]) => `<figure style="margin:0"><figcaption>${title}</figcaption><img style="width:${128 * zoom}px;height:${128 * zoom}px" src="data:${mime};base64,${data.toString("base64")}"></figure>`).join("")}</div></body>`,
    );
    await page
      .locator("img")
      .evaluateAll((images) =>
        Promise.all(images.map((image) => image.decode())),
      );
    await page.screenshot({
      path: `benchmark-results/quality/browser-before-after-${zoom * 100}.png`,
    });
  }
} finally {
  await browser.close();
}
