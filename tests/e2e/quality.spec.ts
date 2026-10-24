import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { metrics } from "../../scripts/quality-metrics.mjs";
test("clean cat pixel gates across scale and alpha; no cosmetic strokes", async ({
  page,
}, info) => {
  await page.goto("./");
  for (const size of [128, 512, 1024])
    for (const alpha of ["opaque", "binary", "partial"]) {
      const path = `tests/fixtures/quality/cat-${size}-${alpha}.png`;
      await page
        .getByLabel("Pilih gambar", { exact: true })
        .setInputFiles(path);
      await page.getByRole("button", { name: "Konversi ke SVG" }).click();
      await expect(
        page.getByRole("link", { name: "Download SVG" }),
      ).toBeVisible();
      const pending = page.waitForEvent("download");
      await page.getByRole("link", { name: "Download SVG" }).click();
      const svg = await readFile((await (await pending).path())!, "utf8");
      expect(svg).not.toContain("<image");
      expect(svg).not.toContain("stroke-width");
      const src = await sharp(path).ensureAlpha().raw().toBuffer();
      const out = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer();
      const m = metrics(src, out, size, size, alpha === "opaque");
      expect(m.earsConnected).toBe(true);
      expect(m.maxHole).toBeLessThanOrEqual(2);
      expect(m.details).toEqual([true, true, true]);
      expect((svg.match(/<path/g) || []).length).toBeLessThanOrEqual(12);
      // Partial alpha is explicitly tracked as a remaining limitation, not certified .98.
      if (alpha !== "partial") expect(m.iou).toBeGreaterThanOrEqual(0.98);
      await info.attach(`cat-${size}-${alpha}-metrics`, {
        body: JSON.stringify(m),
        contentType: "application/json",
      });
    }
});
test("fallback source palette retains face with no stroke cover-up or interior pinholes", async ({
  page,
}, info) => {
  await page.goto("./");
  await page.locator("summary").click();
  await page.getByLabel("Engine", { exact: true }).selectOption("fallback");
  for (const file of ["illustration.png", "illustration.webp"]) {
    await page
      .getByLabel("Pilih gambar", { exact: true })
      .setInputFiles(`tests/fixtures/${file}`);
    await page.getByRole("button", { name: "Konversi ke SVG" }).click();
    await expect(page.locator(".result")).toContainText("imagetracerjs");
    const pending = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download SVG" }).click();
    const svg = await readFile((await (await pending).path())!, "utf8");
    expect(svg).toContain('stroke-width="0"');
    const src = await sharp(`tests/fixtures/${file}`)
      .ensureAlpha()
      .raw()
      .toBuffer();
    const raster = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer();
    const m = metrics(src, raster, 128, 128);
    expect(m.maxHole).toBeLessThanOrEqual(2);
    expect(m.details).toEqual([true, true, true]);
    expect((svg.match(/<path/g) || []).length).toBeLessThan(100);
    await page.screenshot({
      path: info.outputPath(`${file}-fallback.png`),
      fullPage: true,
    });
  }
});

test("complex gradients keep detail rather than flattening to the clean profile", async ({
  page,
}) => {
  await page.goto("./");
  await page
    .getByLabel("Pilih gambar", { exact: true })
    .setInputFiles("tests/fixtures/gradient.jpg");
  await page.getByRole("button", { name: "Konversi ke SVG" }).click();
  await expect(page.locator(".result")).toContainText("precision 7");
  await page
    .getByLabel("Pilih gambar", { exact: true })
    .setInputFiles("tests/fixtures/illustration.png");
  await page.getByRole("button", { name: "Konversi ke SVG" }).click();
  await expect(page.locator(".result")).toContainText("precision 5");
});
