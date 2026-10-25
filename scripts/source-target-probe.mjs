// Offline original-raster probe, with actual exported SVG and independent geometry.
import * as old from "../benchmark-results/stage16b/baseline-wasm/nexora_wasm.js";
import * as now from "../src/engine/wasm/nexora_wasm.js";
import sharp from "sharp";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import {
  geometry,
  chains,
  boundary,
  corners,
  worstBoundary,
} from "./curve-geometry-metrics.mjs";
old.initSync({
  module: await readFile(
    "benchmark-results/stage16b/baseline-wasm/nexora_wasm_bg.wasm",
  ),
});
now.initSync({ module: await readFile("src/engine/wasm/nexora_wasm_bg.wasm") });
await mkdir("benchmark-results/stage16b/probe", { recursive: true });
const result = [];
for (const name of (process.env.TARGET_NAMES || "cubic,wave").split(",")) {
  const size = Number(process.env.TARGET_SIZE || 1024);
  const rgba = await sharp(
    `tests/fixtures/curve-optimization/${name}-${size}.png`,
  )
    .ensureAlpha()
    .raw()
    .toBuffer();
  const ref = geometry(
    await readFile(`tests/fixtures/curve-optimization/${name}.svg`, "utf8"),
  );
  const reference = chains(ref).map((ps) =>
    ps.map((p) => p.map((v) => (v * size) / 256)),
  );
  const variants = [];
  for (const [label, m] of [
    ["stage16", old],
    ["candidate", now],
  ]) {
    const start = performance.now();
    const svg = m.trace_quality(
      rgba,
      size,
      size,
      "illustration",
      "inverse-reduce-reconstruct",
    );
    const ms = performance.now() - start;
    await writeFile(
      `benchmark-results/stage16b/probe/${name}-${size}-${label}.svg`,
      svg,
    );
    const g = geometry(svg);
    const d = boundary(reference, chains(g));
    variants.push({
      label,
      ms,
      inverse: [...m.last_inverse()],
      geometry: d,
      corners: corners(g),
      worst: worstBoundary(reference, chains(g)),
    });
  }
  result.push({ name, size, variants });
  console.log(JSON.stringify(result.at(-1)));
}
await writeFile(
  "benchmark-results/stage16b/probe.json",
  JSON.stringify(result, null, 2),
);
