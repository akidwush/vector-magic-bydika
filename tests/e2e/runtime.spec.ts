import { test, expect } from "@playwright/test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
test("runtime telemetry separates actual worker reuse and reset without changing exports", async ({
  page,
}) => {
  await page.goto("./");
  const rows = [];
  const exports: string[] = [];
  for (let run = 0; run < 3; run++) {
    if (run === 2)
      await page.getByRole("button", { name: "Reset", exact: true }).click();
    if (run !== 1)
      await page
        .getByLabel("Pilih gambar", { exact: true })
        .setInputFiles(
          "tests/fixtures/acute-geometry/triangle-eight-native-srgb-128.png",
        );
    await page
      .getByLabel("Refinement sumber", { exact: true })
      .setChecked(true);
    const start = performance.now();
    await page.getByRole("button", { name: "Konversi ke SVG" }).click();
    await expect(
      page.getByRole("link", { name: "Download SVG" }),
    ).toBeVisible();
    await page.waitForFunction((warm) => {
      const raw = document
        .querySelector(".result")
        ?.getAttribute("data-metrics");
      return raw && JSON.parse(raw).timings?.warm === warm;
    }, run === 1);
    const metrics = JSON.parse(
      (await page.locator(".result").getAttribute("data-metrics"))!,
    );
    const fullBrowserMs = performance.now() - start;
    expect(metrics.timings.warm).toBe(run === 1);
    expect(metrics.timings.workerTotalMs).toBeGreaterThanOrEqual(
      metrics.elapsedMs,
    );
    const pending = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download SVG" }).click();
    exports.push(await readFile((await (await pending).path())!, "utf8"));
    rows.push({ run, fullBrowserMs, metrics });
  }
  expect(new Set(exports).size).toBe(1);
  const root =
    process.env.NEXORA_LOW_RES_ROOT || "benchmark-results/stage16g/browser";
  await mkdir(root, { recursive: true });
  await writeFile(
    root + "/app-worker-runtime.json",
    JSON.stringify(rows, null, 2),
  );
  await writeFile(root + "/app-worker-runtime.svg", exports[0]);
});
