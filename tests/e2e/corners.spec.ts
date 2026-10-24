import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  coincidence,
  coverageMetrics,
  organicFeatures,
} from "../../scripts/shared-edge-metrics.mjs";
import { geometryMetrics } from "../../scripts/stage12-metrics.mjs";
import { metrics } from "../../scripts/quality-metrics.mjs";
test("corner fitting baseline vs adaptive", async ({ page }, info) => {
  test.setTimeout(180000);
  await page.goto("./");
  await mkdir("benchmark-results/stage13", { recursive: true });
  const rows = [];
  for (const name of [
    "../coverage/circle.png",
    "../coverage/oval.png",
    "../corners/square-128.png",
    "../corners/triangle-128.png",
    "../corners/star-128.png",
    "../corners/hair-128.png",
    "../corners/mixed-128.png",
    "../corners/star.jpg",
    "../corners/star.webp",
    "curve.png",
    "junction.png",
    "organic.png",
    "rings.png",
    "rounded.png",
    "diagonal.png",
    "thin.png",
    "pinch.png",
    "curve.jpg",
    "curve.webp",
  ]) {
    const input = name.startsWith("../")
      ? "tests/fixtures/" + name.slice(3)
      : "tests/fixtures/shared-edge/" + name;
    const source = await sharp(input).ensureAlpha().raw().toBuffer();
    await page.getByLabel("Pilih gambar", { exact: true }).setInputFiles(input);
    const variants = [];
    for (const profile of ["planar", "intelligent"]) {
      await page.getByLabel("Profil kontur").selectOption(profile);
      await page.getByRole("button", { name: "Konversi ke SVG" }).click();
      await expect(
        page.getByRole("link", { name: "Download SVG" }),
      ).toBeVisible();
      const perf = JSON.parse(
        (await page.locator(".result").getAttribute("data-metrics"))!,
      );
      const pending = page.waitForEvent("download");
      await page.getByRole("link", { name: "Download SVG" }).click();
      const svg = await readFile((await (await pending).path())!, "utf8");
      expect(svg).not.toMatch(/<image|stroke=|<filter|shape-rendering/);
      await writeFile(
        info.outputPath(`${name.replaceAll("/", "-")}-${profile}.svg`),
        svg,
      );
      const raster = await sharp(Buffer.from(svg))
        .ensureAlpha()
        .raw()
        .toBuffer();
      const topology = coincidence(svg),
        coverage = await coverageMetrics(page, svg);
      const quality = metrics(source, raster, 128, 128, true);
      const features = geometryMetrics(source, raster, 128, 128, false);
      const detailIoU =
        name === "organic.png" ? organicFeatures(source, raster) : undefined;
      if (profile === "intelligent") {
        if (name === "curve.png" || name === "rounded.png")
          expect(svg).toContain("C");
        if (detailIoU)
          for (const iou of detailIoU) expect(iou).toBeGreaterThanOrEqual(0.9);
        expect(perf.topology.incidenceErrors).toBe(0);
        expect(perf.topology.crossingsAfter).toBe(0);
        expect(perf.topology.maxDrift).toBeLessThanOrEqual(1.0);
        expect(topology.unmatchedInterior).toBe(0);
        expect(coverage.geometricGapSamples).toBe(0);
        expect(coverage.geometricOverlapSamples).toBe(0);
      }
      variants.push({
        profile,
        perf,
        topology,
        coverage,
        quality,
        detailIoU,
        features,
      });
    }
    rows.push({ name, variants });
  }
  await writeFile(
    "benchmark-results/stage13/production.json",
    JSON.stringify(rows, null, 2),
  );
});

test("adaptive fitting preserves alpha across scales", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await page.goto("./");
  const rows = [];
  for (const name of [
    "quality/cat-128-partial.png",
    "quality/cat-512-opaque.png",
    "quality/cat-1024-partial.png",
  ]) {
    await page
      .getByLabel("Pilih gambar", { exact: true })
      .setInputFiles("tests/fixtures/" + name);
    await page.getByLabel("Profil kontur").selectOption("intelligent");
    await page.getByRole("button", { name: "Konversi ke SVG" }).click();
    await expect(
      page.getByRole("link", { name: "Download SVG" }),
    ).toBeVisible();
    const perf = JSON.parse(
      (await page.locator(".result").getAttribute("data-metrics"))!,
    );
    const pending = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download SVG" }).click();
    const svg = await readFile((await (await pending).path())!, "utf8");
    const { width, height } = await sharp("tests/fixtures/" + name).metadata();
    const source = await sharp("tests/fixtures/" + name)
      .ensureAlpha()
      .raw()
      .toBuffer();
    const raster = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer();
    const measured = metrics(
      source,
      raster,
      width!,
      height!,
      !name.includes("partial"),
    );
    if (name.includes("partial")) {
      expect(svg).toContain("<mask");
      expect(measured.iou).toBeGreaterThanOrEqual(0.98);
    }
    expect(perf.topology.incidenceErrors).toBe(0);
    expect(perf.topology.crossingsAfter).toBe(0);
    await writeFile(info.outputPath(name.replaceAll("/", "-") + ".svg"), svg);
    rows.push({ name, perf, measured, bytes: Buffer.byteLength(svg) });
  }
  await mkdir("benchmark-results/stage13", { recursive: true });
  await writeFile(
    "benchmark-results/stage13/scaled-alpha.json",
    JSON.stringify(rows, null, 2),
  );
});
