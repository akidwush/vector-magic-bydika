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

test("source refinement: exported geometry, source loss, features and shared ownership", async ({
  page,
}) => {
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
    "stage12/cat-128-blended.png",
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
      for (const refined of [false, true]) {
        await page
          .getByLabel("Optimalkan node", { exact: true })
          .setChecked(true);
        await page
          .getByLabel("Refinement sumber", { exact: true })
          .setChecked(refined);
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
        const filename = `${name.replaceAll("/", "-")}-${profile}-${refined ? "candidate" : "baseline"}.svg`;
        await mkdir("benchmark-results/stage15/exports", { recursive: true });
        await writeFile("benchmark-results/stage15/exports/" + filename, svg);
        variants.push({
          refined,
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
      if (name === "stage12/cat-128-blended.png") {
        expect(newer.perf.profile).toBe("coverage-blend");
        expect(newer.perf.optimization.attempts).toBe(0);
        expect(newer.g.anchors).toBe(old.g.anchors);
      }
      expect(newer.g.paths.length).toBe(old.g.paths.length);
      expect(newer.g.closed).toBe(old.g.closed);
      expect(newer.g.anchors).toBeLessThanOrEqual(old.g.anchors * 4 + 16);

      const delta = boundary(chains(old.g), chains(newer.g));
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
      if (/\/(cubic|wave)-1024\.png$/.test(name)) {
        expect(newer.perf.sourceRefinement.accepted).toBeGreaterThan(0);
        expect(newer.perf.sourceRefinement.lossAfter).toBeLessThan(
          newer.perf.sourceRefinement.lossBefore * 0.9,
        );
        reducedDense = true;
      }
      expect(newer.perf.sourceRefinement.evaluations).toBeLessThanOrEqual(1500);
      expect(newer.raster.mae).toBeLessThanOrEqual(old.raster.mae + 0.15);
      rows.push({ name, width, height, profile, variants, delta });
    }
  }
  expect(reducedDense).toBe(true);
  await mkdir("benchmark-results/stage15", { recursive: true });
  await writeFile(
    "benchmark-results/stage15/production.json",
    JSON.stringify(rows, null, 2),
  );
});

test("source refinement keeps worker reuse, cancellation and unsupported routes safe", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto("./");
  let requests = 0;
  page.on("request", (r) => {
    if (r.url().endsWith(".wasm")) requests++;
  });
  const observations = [];
  for (const refined of [false, true]) {
    if (refined)
      await page.getByRole("button", { name: "Reset", exact: true }).click();
    await page
      .getByLabel("Pilih gambar", { exact: true })
      .setInputFiles("tests/fixtures/curve-optimization/wave-512.png");
    await page
      .getByLabel("Refinement sumber", { exact: true })
      .setChecked(refined);
    const runs = [];
    for (let i = 0; i < 3; i++) {
      await page.getByRole("button", { name: "Konversi ke SVG" }).click();
      await expect(
        page.getByRole("link", { name: "Download SVG" }),
      ).toBeVisible();
      const m = JSON.parse(
        (await page.locator(".result").getAttribute("data-metrics"))!,
      );
      expect(m.warm).toBe(i !== 0);
      expect(m.traceMs).toBeLessThan(5000);
      if (refined) expect(m.sourceRefinement.accepted).toBeGreaterThan(0);
      runs.push(m);
    }
    observations.push({ refined, runs });
  }
  expect(requests).toBe(2);
  await mkdir("benchmark-results/stage15", { recursive: true });
  await writeFile(
    "benchmark-results/stage15/cold-warm.json",
    JSON.stringify(observations, null, 2),
  );
  await page
    .getByLabel("Pilih gambar", { exact: true })
    .setInputFiles("tests/fixtures/curve-optimization/cubic-1024.png");
  await page.getByRole("button", { name: "Konversi ke SVG" }).click();
  await page.getByRole("button", { name: "Batalkan", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("dibatalkan");
  await expect(page.getByRole("link", { name: "Download SVG" })).toHaveCount(0);
  // Eligibility bypass is verified on real exports, including actual transparent pixels.
  for (const name of ["transparent.png", "lineart.png", "gradient.jpg"]) {
    await page
      .getByLabel("Pilih gambar", { exact: true })
      .setInputFiles("tests/fixtures/" + name);
    const svgs = [];
    for (const flag of [false, true]) {
      await page
        .getByLabel("Refinement sumber", { exact: true })
        .setChecked(flag);
      await page.getByRole("button", { name: "Konversi ke SVG" }).click();
      await expect(
        page.getByRole("link", { name: "Download SVG" }),
      ).toBeVisible();
      const pending = page.waitForEvent("download");
      await page.getByRole("link", { name: "Download SVG" }).click();
      svgs.push(await readFile((await (await pending).path())!, "utf8"));
    }
    expect(svgs[1]).toBe(svgs[0]);
  }
  await page.locator('input[value="photo"]').check();
  await page.getByRole("button", { name: "Konversi ke SVG" }).click();
  await expect(page.getByRole("link", { name: "Download SVG" })).toBeVisible();
  const photo = JSON.parse(
    (await page.locator(".result").getAttribute("data-metrics"))!,
  );
  expect(photo.sourceRefinement.enabled).toBe(false);
  expect(photo.sourceRefinement.accepted).toBe(0);
});
