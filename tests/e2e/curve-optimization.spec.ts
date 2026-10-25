import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  geometry,
  chains,
  boundary,
  corners,
} from "../../scripts/curve-geometry-metrics.mjs";
import {
  coincidence,
  coverageMetrics,
  organicFeatures,
} from "../../scripts/shared-edge-metrics.mjs";
import { metrics } from "../../scripts/quality-metrics.mjs";

test("curve optimization: actual SVG node counts, geometry and shared ownership", async ({
  page,
}, info) => {
  test.setTimeout(300000);
  await page.goto("./");
  const rows = [];
  const cases = [
    ...[
      "dense-circle",
      "dense-ellipse",
      "cubic",
      "organic",
      "rounded",
      "wave",
    ].flatMap((n) =>
      [128, 512, 1024].map((s) => `curve-optimization/${n}-${s}.png`),
    ),
    "corners/square-128.png",
    "corners/triangle-128.png",
    "corners/star-128.png",
    "corners/hair-128.png",
    "corners/mixed-128.png",
    "shared-edge/organic.png",
    "shared-edge/thin.png",
    "shared-edge/rings.png",
    "shared-edge/curve.jpg",
    "shared-edge/curve.webp",
    "quality/cat-128-partial.png",
    "quality/cat-512-opaque.png",
  ];
  let reducedDense = false;
  for (const name of cases) {
    const input = "tests/fixtures/" + name;
    const { width, height } = await sharp(input).metadata();
    const source = await sharp(input).ensureAlpha().raw().toBuffer();
    const profiles =
      name === "shared-edge/organic.png" || name === "shared-edge/thin.png"
        ? ["auto", "planar", "intelligent"]
        : ["auto"];
    for (const profile of profiles) {
      await page
        .getByLabel("Pilih gambar", { exact: true })
        .setInputFiles(input);
      await page.getByLabel("Profil kontur").selectOption(profile);
      const variants = [];
      for (const optimize of [false, true]) {
        await page
          .getByLabel("Optimalkan node", { exact: true })
          .setChecked(optimize);
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
        expect(svg).not.toMatch(
          /<image|stroke=|<filter|mix-blend|shape-rendering/,
        );
        const g = geometry(svg);
        const rgba = await sharp(Buffer.from(svg))
          .ensureAlpha()
          .raw()
          .toBuffer();
        const raster = metrics(
          source,
          rgba,
          width!,
          height!,
          !name.includes("partial"),
        );
        if (name.includes("partial"))
          expect(raster.iou).toBeGreaterThanOrEqual(0.98);
        const detail =
          name === "shared-edge/organic.png"
            ? organicFeatures(source, rgba)
            : undefined;
        const shared =
          profile !== "auto"
            ? {
                coincidence: coincidence(svg, width, height),
                coverage: await coverageMetrics(page, svg, width, height),
              }
            : undefined;
        if (shared) {
          expect(shared.coincidence.unmatchedInterior).toBe(0);
          expect(shared.coverage.geometricGapSamples).toBe(0);
          expect(shared.coverage.geometricOverlapSamples).toBe(0);
          expect(perf.topology.crossingsAfter).toBe(0);
        }
        const filename = `${name.replaceAll("/", "-")}-${profile}-${optimize ? "optimized" : "baseline"}.svg`;
        await writeFile(info.outputPath(filename), svg);
        variants.push({
          optimize,
          perf,
          g,
          raster,
          detail,
          shared,
          corners: corners(g),
          filename,
        });
      }
      const [old, newer] = variants;
      expect(newer.g.paths.length).toBe(old.g.paths.length);
      expect(newer.g.closed).toBe(old.g.closed);
      expect(newer.g.anchors).toBeLessThanOrEqual(old.g.anchors);
      expect(newer.g.curves).toBeLessThanOrEqual(old.g.curves);
      const delta = boundary(chains(old.g), chains(newer.g));
      if (!name.includes("dense-circle") && !name.includes("dense-ellipse"))
        expect(delta.max).toBeLessThanOrEqual(0.15);
      if (
        name.includes("triangle") ||
        name.includes("star") ||
        name.includes("square")
      ) {
        expect(newer.corners.length).toBe(old.corners.length);
        for (const p of old.corners)
          expect(
            newer.corners.some(
              (q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-5,
            ),
          ).toBe(true);
      }
      if (newer.detail)
        for (let i = 0; i < newer.detail.length; i++)
          expect(newer.detail[i]).toBeGreaterThanOrEqual(old.detail![i] - 0.01);
      if (name === "curve-optimization/dense-circle-1024.png") {
        expect(newer.g.paths.at(-1)!.curves).toBeLessThanOrEqual(8);
        expect(newer.g.anchors).toBeLessThan(old.g.anchors * 0.5);
        reducedDense = true;
      }
      expect(newer.raster.mae).toBeLessThanOrEqual(old.raster.mae + 0.15);
      rows.push({ name, width, height, profile, variants, delta });
    }
  }
  expect(reducedDense).toBe(true);
  await mkdir("benchmark-results/stage14", { recursive: true });
  await writeFile(
    "benchmark-results/stage14/production.json",
    JSON.stringify(rows, null, 2),
  );
});

test("curve optimization has bounded cold/warm work and reuses WASM", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto("./");
  const rows = [];
  let requests = 0;
  page.on("request", (r) => {
    if (r.url().endsWith(".wasm")) requests++;
  });
  for (const optimize of [false, true]) {
    if (optimize)
      await page.getByRole("button", { name: "Reset", exact: true }).click();
    await page
      .getByLabel("Pilih gambar", { exact: true })
      .setInputFiles("tests/fixtures/curve-optimization/rounded-512.png");
    await page
      .getByLabel("Optimalkan node", { exact: true })
      .setChecked(optimize);
    const runs = [];
    for (let i = 0; i < 3; i++) {
      await page.getByRole("button", { name: "Konversi ke SVG" }).click();
      await expect(
        page.getByRole("link", { name: "Download SVG" }),
      ).toBeVisible();
      const timing = JSON.parse(
        (await page.locator(".result").getAttribute("data-metrics"))!,
      );
      expect(timing.warm).toBe(i !== 0);
      expect(timing.traceMs).toBeLessThan(5000);
      if (optimize)
        expect(timing.optimization.validationSamples).toBeLessThanOrEqual(
          700000,
        );
      runs.push(timing);
    }
    rows.push({ optimize, runs });
  }
  expect(requests).toBe(2);
  // Loose CI stability budget, not a physical Android claim.
  const warm = rows.map(
    (row) => (row.runs[1].traceMs + row.runs[2].traceMs) / 2,
  );
  expect(warm[1]).toBeLessThan(warm[0] * 4 + 150);
  await mkdir("benchmark-results/stage14", { recursive: true });
  await writeFile(
    "benchmark-results/stage14/cold-warm.json",
    JSON.stringify(rows, null, 2),
  );
});
