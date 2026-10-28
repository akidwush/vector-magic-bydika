// Actual engine audit through its binding; no reference SVG or feature coordinates enter tracing.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";
import sharp from "sharp";
import ts from "typescript";
import {
  compareRaster,
  foreground,
  components,
} from "./real-artwork-metrics.mjs";
const root = resolve(process.env.NEXORA_THIN_DIAG_ROOT),
  moduleRoot = resolve(
    process.env.NEXORA_THIN_MODULE ??
      "benchmark-results/stage17b/diagnostic-module-v1",
  );
await mkdir(root);
await mkdir(root + "/exports");
await mkdir(root + "/frames");
await mkdir(root + "/protocol");
await writeFile(
  root + "/protocol/watershed-region-diagnose.mjs",
  await readFile(new URL(import.meta.url)),
);
const fixtures =
  process.env.NEXORA_ART_FIXTURES ?? "tests/fixtures/real-artwork";
const corpus = JSON.parse(await readFile(fixtures + "/manifest.json"));
const old = (
  await readFile(
    (process.env.NEXORA_THIN_BASELINE_RUN ??
      "benchmark-results/stage17a/evaluation-v1") + "/conversions.jsonl",
    "utf8",
  )
)
  .trim()
  .split("\n")
  .map(JSON.parse);
const ids = (
  process.env.NEXORA_THIN_IMAGES ??
  "original-signage-128,original-anime-128,original-small-symbols-128,original-small-symbols-512,original-garden-512-low-contrast,original-garden-512"
).split(",");
const hash = (b) => createHash("sha256").update(b).digest("hex");
const decode = ts.transpileModule(await readFile("src/lib/input.ts", "utf8"), {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
}).outputText;
const validate = ts.transpileModule(await readFile("src/lib/svg.ts", "utf8"), {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
}).outputText;
const server = createServer(async (req, res) => {
  try {
    const p = resolve(
      moduleRoot,
      "." + new URL(req.url, "http://localhost").pathname,
    );
    if (!p.startsWith(moduleRoot + "/")) throw Error();
    res.setHeader(
      "Content-Type",
      extname(p) === ".wasm" ? "application/wasm" : "text/javascript",
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
  page = await browser.newPage();
const all = [];
await writeFile(
  root + "/plan.json",
  JSON.stringify(
    {
      base: "ad770ad49b6168a75c1751bfbed412aad824fc15",
      wasmSHA256: hash(await readFile(moduleRoot + "/nexora_wasm_bg.wasm")),
      glueSHA256: hash(await readFile(moduleRoot + "/nexora_wasm.js")),
      corpusSHA256: hash(await readFile(fixtures + "/manifest.json")),
      scriptSHA256: hash(await readFile(new URL(import.meta.url))),
      ids,
      baselineConfig: process.env.NEXORA_THIN_BASELINE_ID ?? "A-auto",
      candidateConfig: process.env.NEXORA_THIN_CANDIDATE_ID ?? null,
      capture: process.env.NEXORA_THIN_CAPTURE !== "0",
      mode: Number(process.env.NEXORA_THIN_MODE ?? 0),
      policy:
        "Diagnostic binding replay; source and baseline hashes checked. Snapshot cost is not production timing. No references read.",
    },
    null,
    2,
  ),
);
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/nexora_wasm.js`);
  for (const id of ids) {
    const item = corpus.images.find((r) => r.id === id);
    if (!item) throw Error("Unknown image");
    const source = await readFile(fixtures + "/" + item.image);
    if (hash(source) !== item.imageSHA256) throw Error("Source changed");
    const baseline = old.find(
      (r) =>
        r.image === id &&
        r.config.id === (process.env.NEXORA_THIN_BASELINE_ID ?? "A-auto"),
    );
    const result = await page.evaluate(
      async ({
        encoded,
        mime,
        decode,
        validate,
        profile,
        mode,
        capture,
        preset,
      }) => {
        const decoder = await import("data:text/javascript;base64," + decode);
        const input = await decoder.decode(
          new File(
            [Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))],
            "source",
            { type: mime },
          ),
          false,
        );
        const wasm = await import("/nexora_wasm.js");
        await wasm.default();
        wasm.thin_research_configure(0, capture);
        wasm.watershed_research_configure(mode);
        const svg = wasm.trace_quality(
          input.rgba,
          input.width,
          input.height,
          preset,
          "reduce-" + profile,
        );
        const data = {
          ...JSON.parse(wasm.last_region_survival()),
          watershed: JSON.parse(wasm.last_watershed_regions()),
        };
        const b64 = (a) => {
          let s = "";
          for (let i = 0; i < a.length; i += 32768)
            s += String.fromCharCode(...a.subarray(i, i + 32768));
          return btoa(s);
        };
        const frames = data.frames.map((name, i) => ({
          name,
          rgba: b64(wasm.last_region_rgba(i)),
          labels: b64(new Uint8Array(wasm.last_region_labels(i).buffer)),
        }));
        const vectors = data.vectors.map((name, i) => ({
          name,
          svg: wasm.last_region_svg(i),
        }));
        const validator = await import(
          "data:text/javascript;base64," + validate
        );
        return {
          svg: validator.validateSvg(svg).svg,
          data,
          frames,
          vectors,
          inputHash: await crypto.subtle
            .digest("SHA-256", input.rgba)
            .then((a) =>
              [...new Uint8Array(a)]
                .map((x) => x.toString(16).padStart(2, "0"))
                .join(""),
            ),
        };
      },
      {
        encoded: source.toString("base64"),
        mime: item.mime,
        decode: Buffer.from(decode).toString("base64"),
        profile: baseline.runs[0].perf.profile,
        validate: Buffer.from(validate).toString("base64"),
        mode: Number(process.env.NEXORA_THIN_MODE ?? 0),
        capture: process.env.NEXORA_THIN_CAPTURE !== "0",
        preset: item.preset,
      },
    );
    await writeFile(
      root + "/exports/" + id + "-diagnostic.json",
      JSON.stringify(result.data, null, 2),
    );
    await writeFile(root + "/exports/" + id + ".svg", result.svg);
    if (result.inputHash !== baseline.worker.hashes[0])
      throw Error("Different source decode");
    const same = hash(Buffer.from(result.svg)) === baseline.runs[0].svgSHA256;
    if (Number(process.env.NEXORA_THIN_MODE ?? 0) === 0 && !same)
      throw Error("Diagnostics changed exported baseline " + id);
    const wanted = process.env.NEXORA_THIN_CANDIDATE_ID;
    if (wanted) {
      const exported = old.find(
        (r) => r.image === id && r.config.id === wanted,
      );
      if (
        !exported ||
        hash(Buffer.from(result.svg)) !== exported.runs[0].svgSHA256
      )
        throw Error("Diagnostic candidate differs from actual download " + id);
    }

    await writeFile(root + "/exports/" + id + ".svg", result.svg);
    const input = await sharp(source).ensureAlpha().raw().toBuffer();
    const observations = [];
    for (let i = 0; i < result.frames.length; i++) {
      const f = result.frames[i],
        rgba = Buffer.from(f.rgba, "base64");
      await sharp(rgba, {
        raw: { width: item.width, height: item.height, channels: 4 },
      })
        .png()
        .toFile(root + "/frames/" + id + "-" + i + "-" + f.name + ".png");
      await writeFile(
        root + "/frames/" + id + "-" + i + ".labels",
        Buffer.from(f.labels, "base64"),
      );
      const metric = compareRaster(input, rgba, item.width, item.height, {
        background: item.background,
        maskApplicable: item.maskApplicable !== false,
        rois: item.rois,
      });
      delete metric.heat;
      observations.push({ stage: f.name, index: i, ...metric });
    }
    for (const v of result.vectors) {
      await writeFile(root + "/exports/" + id + "-" + v.name + ".svg", v.svg);
      const rgba = await sharp(Buffer.from(v.svg))
        .resize(item.width, item.height)
        .ensureAlpha()
        .raw()
        .toBuffer();
      const metric = compareRaster(input, rgba, item.width, item.height, {
        background: item.background,
        maskApplicable: item.maskApplicable !== false,
        rois: item.rois,
      });
      delete metric.heat;
      observations.push({ stage: v.name, ...metric });
    }
    const row = {
      id,
      split: item.split,
      baselineIdentical: same,
      sourceSHA256: item.imageSHA256,
      svgSHA256: hash(Buffer.from(result.svg)),
      diagnostic: result.data,
      stages: observations,
    };
    all.push(row);
    await writeFile(root + "/" + id + ".json", JSON.stringify(row, null, 2));
    console.log(
      id,
      "identical",
      same,
      "frames",
      result.frames.length,
      "decisions",
      result.data.evaluated,
      "omitted",
      result.data.omitted,
    );
  }
  await writeFile(
    root + "/summary.json",
    JSON.stringify(
      all.map((r) => ({
        id: r.id,
        baselineIdentical: r.baselineIdentical,
        configuration: r.diagnostic.events.find(
          (e) => e.kind === "configuration",
        ),
        stages: r.stages.map((s) => ({
          stage: s.stage,
          mae: s.mae,
          IoU: s.foregroundIoU,
          sourceMask: s.sourceMask,
          outputMask: s.outputMask,
        })),
      })),
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
