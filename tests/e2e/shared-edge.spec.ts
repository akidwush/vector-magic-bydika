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
test("shared graph: exact reversed edges, no geometric gaps/overlap, renderer measured separately", async ({
  page,
}, info) => {
  test.setTimeout(180000);
  await page.goto("./");
  await mkdir("benchmark-results/shared-edge", { recursive: true });
  const rows = [];
  for (const name of [
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
    const input = "tests/fixtures/shared-edge/" + name;
    const source = await sharp(input).ensureAlpha().raw().toBuffer();
    await page.getByLabel("Pilih gambar", { exact: true }).setInputFiles(input);
    const variants = [];
    for (const profile of ["auto", "shared", "planar"]) {
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
      await writeFile(info.outputPath(`${name}-${profile}.svg`), svg);
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
      if (profile === "planar") {
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
        expect(quality.mae).toBeLessThan(12);
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
    "benchmark-results/shared-edge/production.json",
    JSON.stringify(rows, null, 2),
  );
});

test("gap metric distinguishes a real gap, real overlap and a coincident boundary", async ({
  page,
}) => {
  const svg = (left: number) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><path d="M0 0H8V16H0Z" fill="red"/><path d="M${left} 0H16V16H${left}Z" fill="blue"/></svg>`;
  const good = await coverageMetrics(page, svg(8), 16, 16);
  expect(good.geometricGapSamples).toBe(0);
  expect(good.geometricOverlapSamples).toBe(0);
  const gap = await coverageMetrics(page, svg(9), 16, 16);
  expect(gap.geometricGapSamples).toBe(64);
  const overlap = await coverageMetrics(page, svg(7), 16, 16);
  expect(overlap.geometricOverlapSamples).toBe(64);
});

test("locked graph keeps opacity and reports actual larger-input timings", async ({
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
    await page.getByLabel("Profil kontur").selectOption("planar");
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
  await mkdir("benchmark-results/shared-edge", { recursive: true });
  await writeFile(
    "benchmark-results/shared-edge/scaled-alpha.json",
    JSON.stringify(rows, null, 2),
  );
});
