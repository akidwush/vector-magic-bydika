// Offline experiment; never called by Convert.
import * as old from "../benchmark-results/stage15/baseline-wasm/nexora_wasm.js";
import * as w from "../src/engine/wasm/nexora_wasm.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import sharp from "sharp";
import assert from "node:assert/strict";
import { geometry } from "./curve-geometry-metrics.mjs";
old.initSync({
  module: await readFile(
    "benchmark-results/stage15/baseline-wasm/nexora_wasm_bg.wasm",
  ),
});
w.initSync({ module: await readFile("src/engine/wasm/nexora_wasm_bg.wasm") });
await mkdir("benchmark-results/stage15/probe", { recursive: true });
let rows = [];
for (const name of process.env.STAGE15_NAMES?.split(",") ?? [
  "cubic",
  "wave",
  "organic",
  "rounded",
  "dense-circle",
  "dense-ellipse",
])
  for (const size of process.env.STAGE15_SIZES?.split(",").map(Number) ?? [
    128, 512, 1024,
  ]) {
    const b = await sharp(
      `tests/fixtures/curve-optimization/${name}-${size}.png`,
    )
      .ensureAlpha()
      .raw()
      .toBuffer();
    const variants = [];
    for (const mode of ["baseline", "candidate"]) {
      const t = performance.now();
      const svg = (mode === "baseline" ? old : w).trace_quality(
        b,
        size,
        size,
        "illustration",
        (mode === "baseline" ? "" : "inverse-") + "reduce-reconstruct",
      );
      const ms = performance.now() - t;
      if (mode === "baseline")
        assert.equal(
          w.trace_quality(b, size, size, "illustration", "reduce-reconstruct"),
          svg,
          "Disabled refinement must reproduce 7a704b8 geometry",
        );
      await writeFile(
        `benchmark-results/stage15/probe/${name}-${size}-${mode}.svg`,
        svg,
      );
      variants.push({
        mode,
        ms,
        g: geometry(svg),
        inverse: mode === "candidate" ? Array.from(w.last_inverse()) : [],
      });
    }
    rows.push({ name, size, variants });
    console.log(
      name,
      size,
      variants.map((v) => [v.g.anchors, v.ms.toFixed(1), v.inverse]),
    );
  }
await writeFile(
  "benchmark-results/stage15/probe.json",
  JSON.stringify(rows, null, 2),
);
