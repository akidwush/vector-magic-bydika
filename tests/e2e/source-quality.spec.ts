import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { primitives } from "../../scripts/shared-edge-metrics.mjs";
import { metrics } from "../../scripts/quality-metrics.mjs";
import { geometryMetrics } from "../../scripts/stage12-metrics.mjs";

test("source reconstruction on held-out illustration, alpha and compression", async ({
  page,
}, info) => {
  test.setTimeout(180000);
  await page.goto("./");
  const rows = [];
  for (const name of [
    "quality/cat-128-opaque.png",
    "quality/cat-128-partial.png",
    "stage12/cat-128-blended.png",
    "stage12/openmoji-cat-128.png",
    "stage12/cat-128-lossy.jpg",
    "stage12/cat-128-lossy.webp",
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
    for (const profile of ["pre-source", "auto"]) {
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
      const raster = await sharp(Buffer.from(svg))
        .ensureAlpha()
        .raw()
        .toBuffer();
      const measured = metrics(
        source,
        raster,
        128,
        128,
        !name.includes("partial") && !name.includes("openmoji"),
      );
      const features = geometryMetrics(
        source,
        raster,
        128,
        128,
        !name.includes("openmoji"),
      );
      await writeFile(
        info.outputPath(name.replaceAll("/", "-") + "-" + profile + ".svg"),
        svg,
      );
      const boundaryX = name.includes("coverage/edge-")
        ? primitives(svg)
            .flatMap((p) => p.edges)
            .filter(
              (ps) =>
                ps[0][0] > 1 &&
                ps[0][0] < 127 &&
                ps.every((p) => Math.abs(p[0] - ps[0][0]) < 1e-5) &&
                Math.abs(ps.at(-1)![1] - ps[0][1]) > 100,
            )
            .map((ps) => ps[0][0])
        : undefined;
      if (boundaryX) {
        expect(boundaryX.length).toBeGreaterThan(0);
        for (const x of boundaryX)
          expect(Math.abs(x - 63.25)).toBeLessThanOrEqual(0.1);
      }
      variants.push({ profile, perf, measured, features, boundaryX });
      if (name.includes("partial")) {
        expect(measured.iou).toBeGreaterThanOrEqual(0.98);
        expect(svg).toContain("<mask");
      }
    }
    if (name.includes("coverage/edge-")) {
      const oldError = Math.max(
        ...variants[0].boundaryX!.map((x) => Math.abs(x - 63.25)),
      );
      for (const x of variants[1].boundaryX!)
        expect(Math.abs(x - 63.25)).toBeLessThanOrEqual(oldError + 1e-5);
    }
    rows.push({ name, variants });
  }
  await mkdir("benchmark-results/source-quality", { recursive: true });
  await writeFile(
    "benchmark-results/source-quality/held-out.json",
    JSON.stringify(rows, null, 2),
  );
});
