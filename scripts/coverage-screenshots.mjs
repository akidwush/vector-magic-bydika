import { chromium } from "@playwright/test";
import { readFile, readdir } from "node:fs/promises";
import sharp from "sharp";
const folder = (await readdir("test-results")).find((n) =>
  n.startsWith("coverage-old-main"),
);
if (!folder) throw new Error("Run coverage browser test first");
const browser = await chromium.launch({
  executablePath: process.env.NEXORA_CHROMIUM_PATH,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 750 },
  });
  for (const file of [
    "quality/cat-128-opaque.png",
    "quality/cat-128-partial.png",
    "coverage/circle.png",
    "coverage/triangle.png",
    "coverage/pink.png",
    "coverage/edge-srgb.png",
  ]) {
    const source = await sharp("tests/fixtures/" + file)
        .png()
        .toBuffer(),
      key = file.replaceAll("/", "-");
    const images = [
      ["Original", source, "image/png"],
      [
        "Before: main 1e0af0d",
        await readFile(`test-results/${folder}/${key}-previous.svg`),
        "image/svg+xml",
      ],
      [
        "After: coverage + vector alpha",
        await readFile(`test-results/${folder}/${key}-auto.svg`),
        "image/svg+xml",
      ],
    ];
    for (const zoom of [1, 4]) {
      await page.setContent(
        `<body style="font:16px sans-serif;background:#ddd"><h1>${file} · ${zoom * 100}% · same input and scale</h1><div style="display:flex;gap:10px">${images.map(([label, data, mime]) => `<figure style="margin:0"><figcaption>${label}</figcaption><img style="background:repeating-conic-gradient(#eee 0% 25%,white 0% 50%) 50%/16px 16px" width="${128 * zoom}" height="${128 * zoom}" src="data:${mime};base64,${data.toString("base64")}"></figure>`).join("")}</div></body>`,
      );
      await page
        .locator("img")
        .evaluateAll((images) => Promise.all(images.map((i) => i.decode())));
      await page.screenshot({
        path: `benchmark-results/coverage/${key}-${zoom * 100}.png`,
      });
    }
  }
} finally {
  await browser.close();
}
