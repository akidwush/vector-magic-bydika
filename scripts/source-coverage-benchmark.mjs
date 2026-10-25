// Compare the actual Rust evaluator, occupancy grids, analytic area and libvips.
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import sharp from "sharp";
const log = execFileSync(
  "cargo",
  [
    "test",
    "--manifest-path",
    "engine/Cargo.toml",
    "--locked",
    "coverage_converges_on_curves",
    "--",
    "--nocapture",
  ],
  { encoding: "utf8" },
);
const row = JSON.parse(log.match(/COVERAGE_JSON (\{[^\n]+\})/)[1]);
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1"><rect width="1" height="1" fill="white"/><path d="M0 0C1 0 1 1 0 1Z" fill="black"/></svg>';
const im = await sharp(Buffer.from(svg), { density: 72 * 256 })
  .removeAlpha()
  .raw()
  .toBuffer();
row.libvips = 1 - im.reduce((a, b) => a + b, 0) / im.length / 255;
assert(Math.abs(row.libvips - 0.6) < 0.001);
assert(Math.abs(row.polygon[3] - row.libvips) < 0.001);
assert(Math.abs(row.polygon[2] - 0.6) < Math.abs(row.occupancy[0] - 0.6));
await mkdir("benchmark-results/stage15", { recursive: true });
await writeFile(
  "benchmark-results/stage15/coverage.json",
  JSON.stringify(row, null, 2),
);
console.log(row);
