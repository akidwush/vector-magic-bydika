// Actual opt-in application Worker lifecycle, with unscaled real idle cleanup.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { chromium, expect } from "@playwright/test";
const moduleName = process.env.NEXORA_THIN_CANDIDATE_ID ?? "thin-structural";
const prefix = "/app/" + moduleName + "/";
const root = resolve(process.env.NEXORA_THIN_WORKER_PROOF),
  modules = resolve(process.env.NEXORA_ART_BUILDS),
  evaluation = resolve(process.env.NEXORA_THIN_EVALUATION),
  fixture = resolve(
    process.env.NEXORA_ART_FIXTURES ?? "tests/fixtures/real-artwork",
  );
await mkdir(root);
const rows = (await readFile(evaluation + "/conversions.jsonl", "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse),
  target = "circuit-ribbon-128",
  expected = rows.find(
    (r) =>
      r.image === target &&
      r.config.id ===
        (process.env.NEXORA_THIN_CANDIDATE_ID ?? "thin-structural"),
  ).runs[0].svgSHA256,
  sha = (b) => createHash("sha256").update(b).digest("hex");
const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://localhost").pathname,
      relative = u.slice(prefix.length) || "index.html";
    if (!u.startsWith(prefix)) throw Error();
    const p = resolve(
      modules,
      (process.env.NEXORA_THIN_CANDIDATE_ID ?? "thin-structural") + "/app",
      relative,
    );
    if (
      !p.startsWith(
        modules +
          "/" +
          (process.env.NEXORA_THIN_CANDIDATE_ID ?? "thin-structural") +
          "/app/",
      )
    )
      throw Error();
    res.setHeader(
      "Content-Type",
      {
        ".js": "text/javascript",
        ".wasm": "application/wasm",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".html": "text/html",
      }[extname(p)] ?? "application/octet-stream",
    );
    res.end(await readFile(p));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({
    executablePath: process.env.NEXORA_CHROMIUM_PATH,
  }),
  page = await browser.newPage({ acceptDownloads: true }),
  consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(String(e)));
const evidence = {
  status: "RUNNING",
  manifest: JSON.parse(
    await readFile(
      modules +
        "/" +
        (process.env.NEXORA_THIN_CANDIDATE_ID ?? "thin-structural") +
        "/manifest.json",
    ),
  ),
  expectedSVG: expected,
  notes: [
    "Lifecycle test; no latency claim. Real 30-second idle timer, no accelerated clock. Cancellation is terminate-worker; stage reached before termination is not inferred.",
  ],
};
try {
  await page.addInitScript(() => {
    window.__thinLife = {
      created: 0,
      terminated: 0,
      requests: 0,
      results: [],
      revoked: 0,
      beats: [],
    };
    const N = window.Worker,
      R = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (u) => {
      window.__thinLife.revoked++;
      R(u);
    };
    window.Worker = class extends N {
      constructor(...a) {
        super(...a);
        window.__thinLife.created++;
        this.addEventListener("message", (e) =>
          window.__thinLife.results.push({
            id: e.data.id,
            research: e.data.thinResearch,
          }),
        );
      }
      postMessage(...a) {
        window.__thinLife.requests++;
        super.postMessage(...a);
      }
      terminate() {
        window.__thinLife.terminated++;
        super.terminate();
      }
    };
    setInterval(() => window.__thinLife.beats.push(performance.now()), 100);
  });
  await page.goto(`http://127.0.0.1:${server.address().port}${prefix}`);
  async function select(id) {
    await page
      .getByLabel("Pilih gambar", { exact: true })
      .setInputFiles(fixture + "/images/" + id + ".png");
    await page.locator('input[name="preset"][value="illustration"]').check();
    await page.getByLabel("Profil kontur").selectOption("auto");
    await page.getByLabel("Optimalkan node", { exact: true }).check();
  }
  async function complete(name) {
    const completed = await page.evaluate(
      () => window.__thinLife.results.length,
    );
    await page.getByRole("button", { name: "Konversi ke SVG" }).click();
    await page.waitForFunction(
      (n) => window.__thinLife.results.length > n,
      completed,
      { timeout: 45000 },
    );
    await expect(page.getByRole("link", { name: "Download SVG" })).toBeVisible({
      timeout: 45000,
    });
    const pending = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download SVG" }).click();
    const d = await pending;
    await d.saveAs(root + "/" + name + ".svg");
    const hash = sha(await readFile(root + "/" + name + ".svg"));
    expect(hash).toBe(expected);
    return hash;
  }
  await select(target);
  evidence.first = await complete("first");
  evidence.warm = await complete("warm");
  expect(await page.evaluate(() => window.__thinLife.created)).toBe(1);
  const beforeIdle = await page.evaluate(() => window.__thinLife.terminated),
    idleStart = performance.now();
  await page.waitForFunction(
    (n) => window.__thinLife.terminated > n,
    beforeIdle,
    { timeout: 35000 },
  );
  evidence.observedIdleCleanupWaitMs = performance.now() - idleStart;
  await select("original-garden-512");
  const requests = await page.evaluate(() => window.__thinLife.requests),
    terminated = await page.evaluate(() => window.__thinLife.terminated);
  await page.getByRole("button", { name: "Konversi ke SVG" }).click();
  await page.waitForFunction((n) => window.__thinLife.requests > n, requests);
  await page.getByRole("button", { name: "Batalkan", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("dibatalkan");
  expect(
    await page.evaluate(() => window.__thinLife.terminated),
  ).toBeGreaterThan(terminated);
  await expect(page.getByRole("link", { name: "Download SVG" })).toHaveCount(0);
  await select(target);
  evidence.afterCancellation = await complete("after-cancellation");
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.getByRole("link", { name: "Download SVG" })).toHaveCount(0);
  evidence.worker = await page.evaluate(() => window.__thinLife);
  expect(evidence.worker.revoked).toBeGreaterThanOrEqual(3);
  for (const r of evidence.worker.results.filter((r) => r.research)) {
    expect(r.research.mode).toBe(Number(process.env.NEXORA_THIN_MODE ?? 3));
    expect(r.research.sourceRetained).toBe(false);
    expect(r.research.cacheEntries).toBe(0);
    expect(r.research.protected).toBeLessThanOrEqual(64);
  }
  expect(consoleErrors).toEqual([]);
  evidence.status = "PASS";
  console.log({
    status: "PASS",
    created: evidence.worker.created,
    terminated: evidence.worker.terminated,
    idleMs: evidence.observedIdleCleanupWaitMs,
  });
} catch (e) {
  evidence.status = "FAIL";
  evidence.error = String(e);
  process.exitCode = 1;
} finally {
  evidence.consoleErrors = consoleErrors;
  await writeFile(root + "/lifecycle.json", JSON.stringify(evidence, null, 2));
  await page.screenshot({ path: root + "/final-state.png" });
  await browser.close();
  await new Promise((r) => server.close(r));
}
