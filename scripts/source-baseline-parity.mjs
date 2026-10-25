// Optional local proof against the archived verified main build (not committed).
import * as old from "../benchmark-results/stage15/baseline-wasm/nexora_wasm.js";
import * as current from "../src/engine/wasm/nexora_wasm.js";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import sharp from "sharp";
old.initSync({
  module: await readFile(
    "benchmark-results/stage15/baseline-wasm/nexora_wasm_bg.wasm",
  ),
});
current.initSync({
  module: await readFile("src/engine/wasm/nexora_wasm_bg.wasm"),
});
const results = [];
for (const name of [
  "cubic",
  "wave",
  "dense-circle",
  "dense-ellipse",
  "rounded",
  "organic",
])
  for (const size of [128, 512, 1024]) {
    const rgba = await sharp(
      `tests/fixtures/curve-optimization/${name}-${size}.png`,
    )
      .ensureAlpha()
      .raw()
      .toBuffer();
    const a = old.trace_quality(
        rgba,
        size,
        size,
        "illustration",
        "reduce-reconstruct",
      ),
      b = current.trace_quality(
        rgba,
        size,
        size,
        "illustration",
        "reduce-reconstruct",
      );
    assert.equal(a, b, name + " " + size + " baseline mismatch");
    results.push({ name, size, identical: true });
  }
await writeFile(
  "benchmark-results/stage15/baseline-parity.json",
  JSON.stringify(results, null, 2),
);
console.log(
  "18/18 disabled native exports exactly match verified main 7a704b8.",
);
