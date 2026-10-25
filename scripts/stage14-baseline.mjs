import * as w from "../benchmark-results/stage14/baseline-wasm/nexora_wasm.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import sharp from "sharp";
import { analyzeInput, chooseProfile } from "../src/engine/diagnostics.ts";
import { svgPoints } from "./stage12-svg-metrics.mjs";
w.initSync({
  module: await readFile(
    "benchmark-results/stage14/baseline-wasm/nexora_wasm_bg.wasm",
  ),
});
await mkdir("benchmark-results/stage14/baseline", { recursive: true });
const rows = [];
for (const name of [
  "dense-circle",
  "dense-ellipse",
  "cubic",
  "organic",
  "rounded",
  "wave",
])
  for (const size of [128, 512, 1024]) {
    const data = await sharp(
      `tests/fixtures/curve-optimization/${name}-${size}.png`,
    )
      .ensureAlpha()
      .raw()
      .toBuffer();
    const d = analyzeInput({
      rgba: data,
      width: size,
      height: size,
      sourceFormat: "image/png",
    });
    let base = chooseProfile(d, "illustration", "auto");
    let profile =
      base === "source"
        ? d.classification === "blended-flat"
          ? "reconstruct-blend"
          : "reconstruct"
        : d.dominantCoverage >= 0.85
          ? `coverage-${base}`
          : base;
    const t = performance.now(),
      svg = w.trace_quality(data, size, size, "illustration", profile),
      ms = performance.now() - t;
    await writeFile(
      `benchmark-results/stage14/baseline/${name}-${size}.svg`,
      svg,
    );
    rows.push({
      name,
      size,
      profile,
      ms,
      bytes: Buffer.byteLength(svg),
      ...svgPoints(svg),
    });
  }
await writeFile(
  "benchmark-results/stage14/baseline.json",
  JSON.stringify(rows, null, 2),
);
console.log(rows);
