// Offline replay against a WASM snapshot captured from baseline main before changes.
// Copy that revision's generated JS/WASM to benchmark-results/stage14/baseline-wasm.
import * as old from "../benchmark-results/stage14/baseline-wasm/nexora_wasm.js";
import * as current from "../src/engine/wasm/nexora_wasm.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import sharp from "sharp";
import { analyzeInput, chooseProfile } from "../src/engine/diagnostics.ts";
import { geometry } from "./curve-geometry-metrics.mjs";
old.initSync({
  module: await readFile(
    "benchmark-results/stage14/baseline-wasm/nexora_wasm_bg.wasm",
  ),
});
const core = current.initSync({
  module: await readFile("src/engine/wasm/nexora_wasm_bg.wasm"),
});
const out = "benchmark-results/stage14";
await mkdir(out + "/replay", { recursive: true });
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
    const rgba = await sharp(
      `tests/fixtures/curve-optimization/${name}-${size}.png`,
    )
      .ensureAlpha()
      .raw()
      .toBuffer();
    const d = analyzeInput({
      rgba,
      width: size,
      height: size,
      sourceFormat: "image/png",
    });
    const base = chooseProfile(d, "illustration", "auto");
    const profile =
      base === "source"
        ? d.classification === "blended-flat"
          ? "reconstruct-blend"
          : "reconstruct"
        : d.dominantCoverage >= 0.85
          ? `coverage-${base}`
          : base;
    const baseline = old.trace_quality(
      rgba,
      size,
      size,
      "illustration",
      profile,
    );
    assert.equal(
      current.trace_quality(rgba, size, size, "illustration", profile),
      baseline,
      name + ": disabled optimization is not baseline-identical",
    );
    const times = [[], []];
    let svg;
    for (let repeat = 0; repeat < 3; repeat++)
      for (const index of repeat % 2 ? [1, 0] : [0, 1]) {
        const t = performance.now();
        const result = (index ? current : old).trace_quality(
          rgba,
          size,
          size,
          "illustration",
          (index ? "reduce-" : "") + profile,
        );
        times[index].push(performance.now() - t);
        if (index) svg = result;
      }
    await writeFile(`${out}/replay/${name}-${size}-optimized.svg`, svg);
    const a = geometry(baseline),
      b = geometry(svg);
    const row = {
      name,
      size,
      profile,
      baselineParity: true,
      anchors: [a.anchors, b.anchors],
      curves: [a.curves, b.curves],
      bytes: [a.bytes, b.bytes],
      medianMs: times.map((ts) => ts.sort((a, b) => a - b)[1]),
      samplesMs: times,
      wasmLinearBytes: core.memory.buffer.byteLength,
    };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
await writeFile(out + "/replay.json", JSON.stringify(rows, null, 2));
