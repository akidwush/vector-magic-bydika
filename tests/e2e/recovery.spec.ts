import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { geometry } from "../../scripts/curve-geometry-metrics.mjs";

test("output recovery freezes reduced topology, excludes wedges and reports bounded work", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.goto("./");
  for (const [name, limit] of [
    ["cubic", 73],
    ["wave", 57],
  ] as const) {
    await page
      .getByLabel("Pilih gambar", { exact: true })
      .setInputFiles(`tests/fixtures/curve-optimization/${name}-1024.png`);
    await page
      .getByLabel("Refinement sumber", { exact: true })
      .setChecked(false);
    await page.getByRole("button", { name: "Konversi ke SVG" }).click();
    await expect(
      page.getByRole("link", { name: "Download SVG" }),
    ).toBeVisible();
    const baseline = JSON.parse(
      (await page.locator(".result").getAttribute("data-metrics"))!,
    );
    if (baseline.sourceGeometry)
      expect(baseline.sourceGeometry.accepted).toBe(0);
    await page
      .getByLabel("Refinement sumber", { exact: true })
      .setChecked(true);
    await page.getByRole("button", { name: "Konversi ke SVG" }).click();
    await expect(
      page.getByRole("link", { name: "Download SVG" }),
    ).toBeVisible();
    const metrics = JSON.parse(
      (await page.locator(".result").getAttribute("data-metrics"))!,
    );
    // The default build intentionally omits the research feature. The research
    // runner rebuilds with source_geometry and executes these same assertions.
    if (metrics.sourceGeometry) {
      const r = metrics.sourceGeometry;
      expect(r.accepted).toBeGreaterThan(0);
      expect(r.components).toBeLessThanOrEqual(4);
      expect(r.spansAccepted).toBeGreaterThan(0);
      expect(r.apexUpdates).toBeGreaterThan(0);
      expect(r.straightLocks).toBeGreaterThan(0);
      expect(r.targetObservations).toBeGreaterThan(16);
      expect(r.wedgeRejected).toBeGreaterThan(0);
      expect(r.coverageLossAfter).toBeLessThan(r.coverageLossBefore);
      expect(r.apexLossAfter).toBeLessThan(r.apexLossBefore);
      expect(r.coverageEvaluations).toBeLessThan(512);
      expect(r.elapsedMs).toBeLessThan(2000);
    }
    const pending = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download SVG" }).click();
    const svg = await readFile((await (await pending).path())!, "utf8");
    expect(svg).not.toMatch(/<image|stroke=|<filter/);
    const g = geometry(svg);
    expect(g.anchors).toBeLessThanOrEqual(limit);
    expect(g.closed).toBe(2);
    for (const edge of g.paths.flatMap((p) => p.edges))
      if (
        edge.length === 2 &&
        Math.hypot(edge[1][0] - edge[0][0], edge[1][1] - edge[0][1]) > 100
      ) {
        expect(
          Math.min(
            Math.abs(edge[1][0] - edge[0][0]),
            Math.abs(edge[1][1] - edge[0][1]),
          ),
        ).toBeLessThan(1e-6);
      }
  }
});
