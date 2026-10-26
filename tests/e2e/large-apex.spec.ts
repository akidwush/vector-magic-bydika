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
test("source-certified large G0 displacement survives worker SVG export", async ({
  page,
}) => {
  await page.goto("./");
  await page
    .getByLabel("Pilih gambar", { exact: true })
    .setInputFiles(
      "tests/fixtures/acute-geometry/triangle-eight-native-srgb-128.png",
    );
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
      await readFile(
        "tests/fixtures/acute-geometry/triangle-eight.svg",
        "utf8",
      ),
    );
  const reference = chains(ref).map((ps) => ps.map((p) => p.map((v) => v / 2)));
  const error = boundary(reference, chains(g));
  const corner = cornerMetrics(
    g,
    corners(ref).map((p) => p.map((v) => v / 2)),
  );
  expect(svg).not.toMatch(/<image|stroke=|<filter/);
  expect(structure(g).properCrossings).toBe(0);
  if (process.env.NEXORA_LARGE_APEX) {
    expect(metrics.sourceGeometry).toBeTruthy();
    expect(error.max).toBeLessThan(0.6);
    expect(error.p95).toBeLessThan(0.4);
    expect(corner.precision).toBe(1);
    expect(corner.recall).toBe(1);
  }
  const root =
    process.env.NEXORA_LOW_RES_ROOT || "benchmark-results/stage16f/browser";
  await mkdir(root, { recursive: true });
  await writeFile(root + "/large-128.svg", svg);
  await writeFile(
    root + "/large-128.json",
    JSON.stringify({ error, corner, metrics }, null, 2),
  );
});
