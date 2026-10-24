import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { metrics } from "../../scripts/quality-metrics.mjs";
import { geometryMetrics } from "../../scripts/stage12-metrics.mjs";
test("old-main vs coverage: real downloaded geometry, intentional pink and alpha target", async ({
  page,
}, info) => {
  await page.goto("./");
  await mkdir("benchmark-results/coverage", { recursive: true });
  const rows = [];
  for (const name of [
    "quality/cat-128-opaque.png",
    "quality/cat-128-partial.png",
    "coverage/circle.png",
    "coverage/oval.png",
    "coverage/diagonal.png",
    "coverage/triangle.png",
    "coverage/pink.png",
    "coverage/edge-srgb.png",
    "coverage/edge-linear.png",
  ]) {
    const source = await sharp("tests/fixtures/" + name)
      .ensureAlpha()
      .raw()
      .toBuffer();
    await page
      .getByLabel("Pilih gambar", { exact: true })
      .setInputFiles("tests/fixtures/" + name);
    const variants = [];
    for (const profile of ["previous", "auto"]) {
      await page.getByLabel("Profil kontur").selectOption(profile);
      await page.getByRole("button", { name: "Konversi ke SVG" }).click();
      await expect(
        page.getByRole("link", { name: "Download SVG" }),
      ).toBeVisible();
      const data = JSON.parse(
        (await page.locator(".result").getAttribute("data-metrics"))!,
      );
      const pending = page.waitForEvent("download");
      await page.getByRole("link", { name: "Download SVG" }).click();
      const svg = await readFile((await (await pending).path())!, "utf8");
      expect(svg).not.toContain("<image");
      const raster = await sharp(Buffer.from(svg))
        .ensureAlpha()
        .raw()
        .toBuffer();
      const m = metrics(source, raster, 128, 128, !name.includes("partial"));
      const geom = geometryMetrics(
        source,
        raster,
        128,
        128,
        name.includes("cat-"),
      );
      variants.push({
        profile,
        data,
        ...m,
        ...geom,
        bytes: Buffer.byteLength(svg),
      });
      await writeFile(
        info.outputPath(`${name.replaceAll("/", "-")}-${profile}.svg`),
        svg,
      );
      if (profile === "auto" && name.includes("partial")) {
        expect(svg).toContain("<mask");
        expect(m.iou).toBeGreaterThanOrEqual(0.98);
        expect(m.alphaMae).toBeLessThan(2);
        const browserPixels = await page
          .getByAltText("Hasil vektor")
          .evaluate((img) => {
            const image = img as HTMLImageElement;
            const c = document.createElement("canvas");
            c.width = c.height = 128;
            const ctx = c.getContext("2d")!;
            ctx.drawImage(image, 0, 0);
            return Array.from(ctx.getImageData(0, 0, 128, 128).data);
          });
        const browserMetric = metrics(
          source,
          new Uint8Array(browserPixels),
          128,
          128,
          false,
        );
        expect(browserMetric.iou).toBeGreaterThanOrEqual(0.98);
        await writeFile(
          "benchmark-results/coverage/browser-alpha.json",
          JSON.stringify(browserMetric, null, 2),
        );
        await info.attach("browser-alpha-metric", {
          body: JSON.stringify(browserMetric),
          contentType: "application/json",
        });
      }
      if (profile === "auto" && name.includes("pink.png")) {
        const i = (60 * 128 + 80) * 4;
        expect(raster[i]).toBeGreaterThan(240);
        expect(raster[i + 1]).toBeGreaterThan(100);
        expect(raster[i + 1]).toBeLessThan(160);
      }
    }
    const [before, after] = variants;
    if (name === "quality/cat-128-opaque.png") {
      expect(after.iou).toBeGreaterThan(before.iou);
      expect(after.mae).toBeLessThan(before.mae);
      expect(after.data.coverage.accepted).toBeGreaterThan(0);
    }
    expect(after.maxHole).toBeLessThanOrEqual(2);
    rows.push({ name, variants });
  }
  await writeFile(
    "benchmark-results/coverage/production.json",
    JSON.stringify(rows, null, 2),
  );
});
