import { test, expect } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import {
  geometry,
  chains,
  boundary,
  corners,
} from "../../scripts/curve-geometry-metrics.mjs";
import {
  cornerMetrics,
  structure,
} from "../../scripts/source-structure-metrics.mjs";
test("source-verified continuity survives actual worker download", async ({
  page,
}) => {
  await page.goto("./");
  await page
    .getByLabel("Pilih gambar", { exact: true })
    .setInputFiles("tests/fixtures/curve-optimization/wave-128.png");
  await page.getByLabel("Refinement sumber", { exact: true }).setChecked(true);
  await page.getByLabel("Optimalkan node", { exact: true }).setChecked(true);
  await page.getByRole("button", { name: "Konversi ke SVG" }).click();
  await expect(page.getByRole("link", { name: "Download SVG" })).toBeVisible();
  const metrics = JSON.parse(
    (await page.locator(".result").getAttribute("data-metrics"))!,
  );
  const pending = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download SVG" }).click();
  const svg = await readFile((await (await pending).path())!, "utf8");
  const g = geometry(svg),
    ref = geometry(
      await readFile("tests/fixtures/curve-optimization/wave.svg", "utf8"),
    );
  const accuracy = cornerMetrics(
    g,
    corners(ref).map((p) => p.map((v) => v * 0.5)),
  );
  const error = boundary(
    chains(ref).map((ps) => ps.map((p) => p.map((v) => v * 0.5))),
    chains(g),
  );
  expect(svg).not.toMatch(/<image|stroke=|<filter/);
  expect(structure(g).properCrossings).toBe(0);
  if (metrics.sourceGeometry) {
    expect(metrics.sourceGeometry.continuityPairs).toBe(4);
    expect(g.anchors).toBeLessThanOrEqual(23);
    expect(accuracy.unexpected).toBe(0);
    expect(accuracy.precision).toBe(1);
    expect(accuracy.recall).toBe(1);
    expect(error.p95).toBeLessThan(0.15);
    expect(error.max).toBeLessThan(0.6);
  }
  const root =
    process.env.NEXORA_LOW_RES_ROOT || "benchmark-results/stage16d/browser";
  await mkdir(root, { recursive: true });
  await writeFile(root + "/wave-continuity.svg", svg);
  await writeFile(
    root + "/wave-continuity.json",
    JSON.stringify({ accuracy, error, metrics }, null, 2),
  );
});
