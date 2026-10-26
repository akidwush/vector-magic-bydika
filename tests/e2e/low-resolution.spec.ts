import { test, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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

test("source-supported acute initialization survives final browser SVG export", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto("./");
  const rows = [];
  const root =
    process.env.NEXORA_LOW_RES_ROOT || "benchmark-results/stage16c/browser";
  await mkdir(root, { recursive: true });
  for (const [name, size, anchorBudget] of [
    ["cubic", 128, 18],
    ["cubic", 512, 38],
    ["wave", 128, 27],
  ] as const) {
    const input = `tests/fixtures/curve-optimization/${name}-${size}.png`;
    await page.getByLabel("Pilih gambar", { exact: true }).setInputFiles(input);
    await page
      .getByLabel("Refinement sumber", { exact: true })
      .setChecked(true);
    await page.getByLabel("Optimalkan node", { exact: true }).setChecked(true);
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
    const g = geometry(svg);
    const ref = geometry(
      await readFile(`tests/fixtures/curve-optimization/${name}.svg`, "utf8"),
    );
    const reference = chains(ref).map((ps) =>
      ps.map((p) => p.map((v) => (v * size) / 256)),
    );
    const error = boundary(reference, chains(g));
    const corner = cornerMetrics(
      g,
      corners(ref).map((p) => p.map((v) => (v * size) / 256)),
    );
    expect(g.anchors).toBeLessThanOrEqual(anchorBudget);
    expect(g.closed).toBe(2);
    expect(structure(g).properCrossings).toBe(0);
    // Normal builds deliberately exclude the experimental geometry feature.
    if (perf.sourceGeometry) {
      expect(perf.sourceGeometry.deferredContexts).toBeGreaterThan(0);
      expect(perf.sourceGeometry.acuteRecovered).toBeGreaterThan(0);
      expect(perf.sourceGeometry.accepted).toBeGreaterThan(0);
      expect(perf.sourceGeometry.capLossAfter).toBeLessThan(
        perf.sourceGeometry.capLossBefore,
      );
      expect(perf.sourceGeometry.initializationMs).toBeLessThan(1000);
      expect(error.max).toBeLessThan(2);
      expect(corner.recall).toBe(1);
      expect(Math.max(...corner.endpointAnchorErrors)).toBeLessThan(1.2);
    }
    await writeFile(`${root}/${name}-${size}.svg`, svg);
    rows.push({
      name,
      size,
      error,
      corner,
      anchors: g.anchors,
      bytes: g.bytes,
      perf,
    });
  }
  await writeFile(root + "/exports.json", JSON.stringify(rows, null, 2));
});
