// Offline original-raster probe, with actual exported SVG and independent geometry.
import sharp from "sharp";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { metrics } from "./quality-metrics.mjs";
import { structure, cornerMetrics } from "./source-structure-metrics.mjs";
import {
  geometry,
  chains,
  boundary,
  corners,
  worstBoundary,
} from "./curve-geometry-metrics.mjs";
const candidateRoot = resolve(
  process.env.NEXORA_CANDIDATE_WASM || "src/engine/wasm",
);
const proofRoot = process.env.NEXORA_PROOF_DIR || "benchmark-results/stage16b";
const baselineRoot = resolve(
  process.env.NEXORA_BASELINE_WASM ||
    "benchmark-results/stage16b/baseline-wasm",
);
const old = await import(pathToFileURL(baselineRoot + "/nexora_wasm.js").href);
const now = await import(pathToFileURL(candidateRoot + "/nexora_wasm.js").href);
old.initSync({
  module: await readFile(baselineRoot + "/nexora_wasm_bg.wasm"),
});
now.initSync({
  module: await readFile(candidateRoot + "/nexora_wasm_bg.wasm"),
});
await mkdir(proofRoot + "/probe", { recursive: true });
const result = [];
const cases = process.env.NEXORA_PROBE_MANIFEST
  ? JSON.parse(await readFile(process.env.NEXORA_PROBE_MANIFEST)).map((r) => ({
      ...r,
      name: r.name + "-" + r.mode,
      size: r.width,
      input: "tests/fixtures/acute-geometry/" + r.filename,
      reference: "tests/fixtures/acute-geometry/" + r.reference,
    }))
  : (process.env.TARGET_NAMES || "cubic,wave")
      .split(",")
      .map((name) => ({ name, size: Number(process.env.TARGET_SIZE || 1024) }));
for (const entry of cases) {
  const { name } = entry;
  const size = entry.size;
  const rgba = await sharp(
    entry.input || `tests/fixtures/curve-optimization/${name}-${size}.png`,
  )
    .ensureAlpha()
    .raw()
    .toBuffer();
  const ref = geometry(
    await readFile(
      entry.reference || `tests/fixtures/curve-optimization/${name}.svg`,
      "utf8",
    ),
  );
  const reference = chains(ref).map((ps) =>
    ps.map((p) => p.map((v) => (v * size) / 256)),
  );
  const variants = [];
  for (const [label, m] of [
    [process.env.NEXORA_BASELINE_LABEL || "stage16", old],
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
    await writeFile(`${proofRoot}/probe/${name}-${size}-${label}.svg`, svg);
    const g = geometry(svg);
    const pixels = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer();
    const d = boundary(reference, chains(g));
    variants.push({
      label,
      ms,
      inverse: [...m.last_inverse()],
      recovery: m.last_recovery ? [...m.last_recovery()] : [],
      initialization: m.last_initialization ? [...m.last_initialization()] : [],
      acuteEvidence: m.last_acute_evidence ? [...m.last_acute_evidence()] : [],
      anchors: g.anchors,
      curves: g.curves,
      bytes: g.bytes,
      raster: metrics(rgba, pixels, size, size, true),
      geometry: d,
      structure: structure(g),
      cornerAccuracy: cornerMetrics(
        g,
        corners(ref).map((p) => p.map((v) => (v * size) / 256)),
      ),
      corners: corners(g),
      worst: worstBoundary(reference, chains(g)),
    });
  }
  result.push({
    name,
    size,
    mode: entry.mode,
    clipped: entry.clipped,
    expectedUncertain: entry.expectedUncertain,
    variants,
  });
  console.log(JSON.stringify(result.at(-1)));
}
await writeFile(proofRoot + "/probe.json", JSON.stringify(result, null, 2));
