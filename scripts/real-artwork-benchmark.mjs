// Conversion phase: real unchanged app/Worker/downloads. This script never opens references.
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { cpus, release } from "node:os";
const hash = (b) => createHash("sha256").update(b).digest("hex");
const root = resolve(
    process.env.NEXORA_ART_ROOT ??
      "benchmark-results/stage17a/evaluation-" + Date.now(),
  ),
  builds = resolve(
    process.env.NEXORA_ART_BUILDS ?? "benchmark-results/stage17a/modules",
  ),
  fixtureRoot = resolve(
    process.env.NEXORA_ART_FIXTURES ?? "tests/fixtures/real-artwork",
  );
await mkdir(root);
await mkdir(root + "/protocol");
for (const name of [
  "real-artwork-benchmark.mjs",
  "real-artwork-fixtures.mjs",
  "real-artwork-builds.mjs",
  "real-artwork-builds.sh",
])
  await writeFile(
    root + "/protocol/" + name,
    await readFile("scripts/" + name),
  );
await mkdir(root + "/exports");
await mkdir(root + "/diagnostics");
const corpusBytes = await readFile(fixtureRoot + "/manifest.json"),
  corpus = JSON.parse(corpusBytes);
const defaultConfigs = [
  {
    id: "A-auto",
    module: "production",
    quality: "auto",
    optimize: true,
    sourceRefine: false,
  },
  {
    id: "B-vtracer-legacy",
    module: "production",
    quality: "legacy",
    optimize: false,
    sourceRefine: false,
  },
  {
    id: "C-geometry-f",
    module: "geometry-f",
    quality: "auto",
    optimize: true,
    sourceRefine: true,
  },
  {
    id: "D-hotpath-h",
    module: "hotpath-h",
    quality: "auto",
    optimize: true,
    sourceRefine: true,
  },
  {
    id: "E-source-only",
    module: "production",
    quality: "auto",
    optimize: true,
    sourceRefine: true,
  },
];
const allConfigs = process.env.NEXORA_ART_CONFIGS_FILE
  ? JSON.parse(await readFile(process.env.NEXORA_ART_CONFIGS_FILE, "utf8"))
  : defaultConfigs;
for (const c of allConfigs) {
  assert(/^[A-Za-z0-9-]+$/.test(c.id) && /^[a-z0-9-]+$/.test(c.module));
  assert(
    ["auto", "legacy", "source", "planar", "intelligent"].includes(c.quality),
  );
  assert(
    typeof c.optimize === "boolean" && typeof c.sourceRefine === "boolean",
  );
}
const configs = allConfigs.filter(
  (c) =>
    !process.env.NEXORA_ART_CONFIGS ||
    process.env.NEXORA_ART_CONFIGS.split(",").includes(c.id),
);
const manifests = {};
for (const name of new Set(configs.map((c) => c.module))) {
  const m = JSON.parse(await readFile(builds + "/" + name + "/manifest.json"));
  assert.equal(
    hash(await readFile(builds + "/" + name + "/nexora_wasm_bg.wasm")),
    m.wasmSHA256,
  );
  manifests[name] = m;
}
const images = corpus.images.filter(
  (r) =>
    !process.env.NEXORA_ART_IMAGES ||
    process.env.NEXORA_ART_IMAGES.split(",").includes(r.id),
);
const plan = {
  baseline: corpus.baseline,
  corpusSHA256: hash(corpusBytes),
  scriptSHA256: hash(await readFile(new URL(import.meta.url))),
  configs,
  manifests,
  images: images.map((r) => ({
    id: r.id,
    imageSHA256: r.imageSHA256,
    split: r.split,
  })),
  rounds: ["first-fresh-worker", "warm-same-worker"],
  resetFamilies: [
    "original-compass",
    "original-anime",
    "original-small-symbols",
    "kenney-city",
  ],
  timeoutMs: 45000,
  policy:
    "Frozen evaluation corpus/thresholds. Real UI controls, adapter eligibility unchanged; no references read or served during conversion. One first/warm pair per image/configuration, not independent runtime sessions. No retries on failure.",
};
await writeFile(root + "/plan.json", JSON.stringify(plan, null, 2));
await writeFile(
  root + "/ATTRIBUTION.md",
  images
    .map((r) => `- ${r.id}: ${r.attribution} Source: ${r.sourceURL}`)
    .join("\n"),
);
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".txt": "text/plain",
};
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, "http://localhost").pathname,
      parts = pathname.split("/");
    if (parts[1] !== "app" || !manifests[parts[2]]) throw Error("not app");
    const dir = resolve(builds, parts[2], "app"),
      p = resolve(dir, parts.slice(3).join("/") || "index.html");
    if (!p.startsWith(dir + "/")) throw Error("path");
    res.setHeader(
      "Content-Type",
      mime[extname(p)] ?? "application/octet-stream",
    );
    res.end(await readFile(p));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({
  executablePath: process.env.NEXORA_CHROMIUM_PATH,
});
const rows = [];
let failed = 0;
await writeFile(
  root + "/environment.json",
  JSON.stringify(
    {
      browser: browser.version(),
      node: process.version,
      kernel: release(),
      cpu: cpus()[0]?.model,
      visibleCPUs: cpus().length,
      quota: await readFile("/sys/fs/cgroup/cpu.max", "utf8").catch(() => null),
      physicalAndroid: "UNVERIFIED",
    },
    null,
    2,
  ),
);
try {
  for (let index = 0; index < images.length; index++) {
    const item = images[index];
    assert.equal(
      hash(await readFile(fixtureRoot + "/" + item.image)),
      item.imageSHA256,
    );
    const ordered = index % 2 ? [...configs].reverse() : configs;
    for (const config of ordered) {
      const id = item.id + "--" + config.id;
      const page = await browser.newPage({ acceptDownloads: true });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      let row = {
        id,
        image: item.id,
        category: item.category,
        split: item.split,
        family: item.family,
        config,
        wasm: manifests[config.module],
        status: "FAILED",
        runs: [],
      };
      try {
        await page.addInitScript(() => {
          const Native = window.Worker;
          window.__art = {
            requests: 0,
            results: 0,
            created: 0,
            terminated: 0,
            hashes: [],
            beats: [],
            regionResearch: [],
          };
          window.Worker = class extends Native {
            constructor(...args) {
              super(...args);
              window.__art.created++;
              this.addEventListener("message", (event) => {
                window.__art.results++;
                if (event.data?.thinResearch)
                  window.__art.regionResearch.push({
                    traceId: event.data.id,
                    ...event.data.thinResearch,
                  });
              });
            }
            postMessage(...args) {
              const d = args[0];
              window.__art.requests++;
              if (d.input?.rgba) {
                const bytes = d.input.rgba;
                window.__art.hashes.push(
                  crypto.subtle
                    .digest("SHA-256", bytes)
                    .then((b) =>
                      [...new Uint8Array(b)]
                        .map((x) => x.toString(16).padStart(2, "0"))
                        .join(""),
                    ),
                );
              }
              return super.postMessage(...args);
            }
            terminate() {
              window.__art.terminated++;
              return super.terminate();
            }
          };
          setInterval(() => window.__art.beats.push(performance.now()), 100);
        });
        await page.goto(
          `http://127.0.0.1:${server.address().port}/app/${config.module}/`,
        );
        async function select() {
          await page
            .getByLabel("Pilih gambar", { exact: true })
            .setInputFiles(fixtureRoot + "/" + item.image);
          await page
            .locator(`input[name="preset"][value="${item.preset}"]`)
            .check();
          await page.getByLabel("Profil kontur").selectOption(config.quality);
          await page
            .getByLabel("Optimalkan node", { exact: true })
            .setChecked(config.optimize);
          await page
            .getByLabel("Refinement sumber", { exact: true })
            .setChecked(config.sourceRefine);
        }
        await select();
        const resetCase =
          plan.resetFamilies.includes(item.family) &&
          !item.variant &&
          item.width >= 512;
        const rounds = resetCase
          ? ["first", "warm", "reset"]
          : ["first", "warm"];
        let firstSvg;
        for (const state of rounds) {
          if (state === "reset") {
            await page
              .getByRole("button", { name: "Reset", exact: true })
              .click();
            await select();
          }
          const target = await page.evaluate(() => window.__art.results + 1);
          const start = performance.now();
          await page.getByRole("button", { name: "Konversi ke SVG" }).click();
          await page.waitForFunction(
            (target) => window.__art.results >= target,
            target,
            { timeout: 45000 },
          );
          await page
            .locator(".result")
            .waitFor({ state: "visible", timeout: 5000 });
          const clickToResultMs = performance.now() - start;
          const perf = JSON.parse(
            await page.locator(".result").getAttribute("data-metrics"),
          );
          assert.equal(
            perf.engine,
            "vtracer-wasm",
            "Fallback is not the requested comparator",
          );
          const pending = page.waitForEvent("download");
          await page.getByRole("link", { name: "Download SVG" }).click();
          const file = root + "/exports/" + id + "--" + state + ".svg";
          await (await pending).saveAs(file);
          const svg = await readFile(file, "utf8");
          assert(!/<image\b|<filter\b|mix-blend/.test(svg));
          if (state === "first") firstSvg = svg;
          else
            assert.equal(
              svg,
              firstSvg,
              "Worker lifetime changed exported geometry",
            );
          const sha = hash(svg);
          row.runs.push({
            state,
            clickToResultMs,
            perf,
            svgSHA256: sha,
            bytes: Buffer.byteLength(svg),
            export: "exports/" + id + "--" + state + ".svg",
          });
        }
        row.worker = await page.evaluate(async () => ({
          ...window.__art,
          hashes: await Promise.all(window.__art.hashes),
          beats: undefined,
          maxHeartbeatGap: window.__art.beats.reduce(
            (m, t, i, a) => (i ? Math.max(m, t - a[i - 1]) : m),
            0,
          ),
        }));
        assert.equal(new Set(row.worker.hashes).size, 1);
        row.status = "EXPORTED";
      } catch (e) {
        failed++;
        row.error = String(e);
        row.lastUi = await page
          .locator("body")
          .innerText()
          .catch(() => null);
        await page
          .screenshot({ path: root + "/diagnostics/" + id + ".png" })
          .catch(() => {});
      } finally {
        row.errors = errors;
        await writeFile(
          root + "/diagnostics/" + id + ".json",
          JSON.stringify(row, null, 2),
        );
        rows.push(row);
        await appendFile(
          root + "/conversions.jsonl",
          JSON.stringify(row) + "\n",
        );
        await page.close();
      }
      console.log(
        JSON.stringify({
          id,
          status: row.status,
          firstMs: row.runs[0]?.perf.traceMs,
          warmMs: row.runs[1]?.perf.traceMs,
          sourceEnabled: row.runs[0]?.perf.sourceRefinement?.enabled,
          error: row.error,
        }),
      );
    }
  }
  const identities = images.map((item) => {
    const rs = rows.filter((r) => r.image === item.id),
      c = rs.find((r) => r.config.id === "C-geometry-f"),
      d = rs.find((r) => r.config.id === "D-hotpath-h");
    return {
      image: item.id,
      sourceHashes: [...new Set(rs.flatMap((r) => r.worker?.hashes ?? []))],
      fEqualsH:
        c && d
          ? c.runs[0]?.svgSHA256 === d.runs[0]?.svgSHA256 &&
            c.status === "EXPORTED" &&
            d.status === "EXPORTED"
          : null,
      autoEqualsCandidate:
        rs.some((r) => r.config.id === "A-auto") && c
          ? rs.find((r) => r.config.id === "A-auto").runs[0]?.svgSHA256 ===
            c.runs[0]?.svgSHA256
          : null,
    };
  });
  await writeFile(
    root + "/conversion-summary.json",
    JSON.stringify(
      {
        status: failed ? "PARTIAL" : "EXPORTED",
        images: images.length,
        configs: configs.length,
        failed,
        identities,
        policy:
          "F/H differences are preserved as observations; never assert geometry identity on unseen artwork without testing.",
      },
      null,
      2,
    ),
  );
  if (failed) process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
