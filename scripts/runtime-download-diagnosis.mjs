// Separate diagnostic. The historical five-second assertion remains unchanged.
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const root = resolve(
  process.env.NEXORA_DOWNLOAD_ROOT ??
    "benchmark-results/stage16j/download-" + Date.now(),
);
await mkdir(root);
await mkdir(root + "/exports");
const port = Number(process.env.NEXORA_TEST_PORT ?? 4187);
const server = spawn(process.execPath, ["scripts/serve-dist.mjs"], {
  env: { ...process.env, NEXORA_PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (b) => (serverLog += b));
server.stderr.on("data", (b) => (serverLog += b));
const origin = `http://127.0.0.1:${port}/nexora/`;
let failures = 0;
const rows = [];
try {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(origin)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  for (let session = 0; session < 3; session++) {
    const browser = await chromium.launch({
      executablePath: process.env.NEXORA_CHROMIUM_PATH,
    });
    try {
      const page = await browser.newPage({ acceptDownloads: true });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.addInitScript(() => {
        const log = (window.__downloadDiagnostics = { events: [], beats: [] });
        const native = window.Worker;
        let serial = 0;
        window.Worker = class extends native {
          constructor(...args) {
            super(...args);
            this.diag = ++serial;
            log.events.push({
              type: "worker-created",
              at: performance.now(),
              worker: this.diag,
              url: String(args[0]),
            });
            this.addEventListener("message", ({ data }) =>
              log.events.push({
                type: "worker-result",
                at: performance.now(),
                worker: this.diag,
                id: data.id,
                error: data.error,
                timings: data.result?.timings,
                engine: data.result?.engine,
              }),
            );
            this.addEventListener("error", (e) =>
              log.events.push({
                type: "worker-error",
                at: performance.now(),
                worker: this.diag,
                message: e.message,
              }),
            );
          }
          postMessage(...args) {
            const d = args[0];
            log.events.push({
              type: "worker-post",
              at: performance.now(),
              worker: this.diag,
              id: d.id,
              width: d.input?.width,
              height: d.input?.height,
              preset: d.preset,
              sourceRefine: d.input?.sourceRefine,
            });
            return super.postMessage(...args);
          }
          terminate() {
            log.events.push({
              type: "worker-terminate",
              at: performance.now(),
              worker: this.diag,
            });
            return super.terminate();
          }
        };
        setInterval(() => log.beats.push(performance.now()), 100);
        addEventListener("DOMContentLoaded", () => {
          let before = "";
          new MutationObserver(() => {
            const status = document.querySelector("[role=status]")?.textContent,
              download = !!document.querySelector("a[download]"),
              metrics = document
                .querySelector(".result")
                ?.getAttribute("data-metrics"),
              key = JSON.stringify([status, download, metrics]);
            if (key !== before) {
              before = key;
              log.events.push({
                type: "ui-state",
                at: performance.now(),
                status,
                download,
                metrics,
              });
            }
          }).observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
          });
        });
      });
      await page.goto(origin);
      for (const [size, refined] of [
        [128, false],
        [128, true],
        [512, false],
      ]) {
        if ((size === 128 && !refined) || size === 512)
          await page
            .getByLabel("Pilih gambar", { exact: true })
            .setInputFiles(
              `tests/fixtures/curve-optimization/dense-circle-${size}.png`,
            );
        await page.getByLabel("Profil kontur").selectOption("auto");
        await page
          .getByLabel("Optimalkan node", { exact: true })
          .setChecked(true);
        await page
          .getByLabel("Refinement sumber", { exact: true })
          .setChecked(refined);
        const id = `s${session}-dense-circle-${size}-${refined}`;
        await page.evaluate(
          (id) =>
            window.__downloadDiagnostics.events.push({
              type: "click-request",
              id,
              at: performance.now(),
            }),
          id,
        );
        await page.getByRole("button", { name: "Konversi ke SVG" }).click();
        let assertion = "PASS",
          error = null;
        try {
          await expect(
            page.getByRole("link", { name: "Download SVG" }),
          ).toBeVisible({ timeout: 5000 });
        } catch (e) {
          assertion = "FAIL";
          error = String(e);
          failures++;
          await writeFile(
            root + "/" + id + "-at-assertion.json",
            JSON.stringify(
              await page.evaluate(() => ({
                diag: window.__downloadDiagnostics,
                body: document.body.innerText,
              })),
              null,
              2,
            ),
          );
          await page.screenshot({
            path: root + "/" + id + "-at-assertion.png",
          });
        }
        // Bounded observation after a recorded FAIL is diagnostic, never a passing retry.
        let completed = true;
        try {
          await page
            .getByRole("link", { name: "Download SVG" })
            .waitFor({ state: "visible", timeout: 30000 });
        } catch {
          completed = false;
        }
        let svgSHA256 = null;
        if (completed) {
          const pending = page.waitForEvent("download");
          await page.getByRole("link", { name: "Download SVG" }).click();
          const download = await pending;
          const file = root + "/exports/" + id + ".svg";
          await download.saveAs(file);
          svgSHA256 = createHash("sha256")
            .update(await readFile(file))
            .digest("hex");
        }
        const row = {
          id,
          session,
          size,
          refined,
          assertion,
          error,
          completed,
          svgSHA256,
          errors: [...errors],
          state: await page.evaluate(() => ({
            diag: window.__downloadDiagnostics,
            body: document.body.innerText,
            metrics: document
              .querySelector(".result")
              ?.getAttribute("data-metrics"),
          })),
        };
        rows.push(row);
        await writeFile(
          root + "/" + id + ".json",
          JSON.stringify(row, null, 2),
        );
        console.log(JSON.stringify({ id, assertion, completed }));
        if (!completed) break;
      }
    } finally {
      await browser.close();
    }
  }
  await writeFile(
    root + "/summary.json",
    JSON.stringify(
      {
        failures,
        rows,
        policy:
          "Three independent browser processes, exact dense-circle-128 off/on then 512 off prefix. Original 5000ms assertion retained; a failing assertion stays FAIL even if completion arrives within later bounded observation.",
      },
      null,
      2,
    ),
  );
  if (failures) process.exitCode = 1;
} finally {
  server.kill("SIGTERM");
  await writeFile(root + "/server.log", serverLog);
}
