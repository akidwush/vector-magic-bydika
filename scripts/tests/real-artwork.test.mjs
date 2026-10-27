import test from "node:test";
import assert from "node:assert/strict";
import {
  compareRaster,
  components,
  sampledBoundary,
  svgComplexity,
  classify,
} from "../real-artwork-metrics.mjs";
const rgba = (w, h, fill) =>
  Uint8Array.from({ length: w * h * 4 }, (_, i) => fill[i % 4]);
test("premultiplied metric ignores hidden RGB, but retains intrinsic alpha error", () => {
  const a = rgba(16, 16, [255, 0, 0, 0]),
    b = rgba(16, 16, [0, 255, 0, 0]);
  assert.equal(compareRaster(a, b, 16, 16).mae, 0);
  b[3] = 128;
  assert(compareRaster(a, b, 16, 16).mae > 0);
});
test("worst-region diagnostics expose a missing small feature hidden by global averaging", () => {
  const a = rgba(128, 128, [255, 255, 255, 255]),
    b = a.slice();
  for (let y = 40; y < 48; y++)
    for (let x = 50; x < 58; x++) a.set([0, 0, 0, 255], (y * 128 + x) * 4);
  const r = compareRaster(a, b, 128, 128, { background: [255, 255, 255] });
  assert(r.mae < 1);
  assert(r.worst[0].mae > 100);
  assert(
    classify(r, { anchors: 0, tinyBBoxPaths: 0, withinPathCrossings: 0 }).some(
      (f) => f.code === "RECONSTRUCTION.LOCAL",
    ),
  );
});
test("negative space survives four/eight connectivity and frame exclusion", () => {
  const m = new Uint8Array(100);
  for (let y = 1; y < 9; y++) for (let x = 1; x < 9; x++) m[y * 10 + x] = 1;
  for (let y = 4; y < 6; y++) for (let x = 4; x < 6; x++) m[y * 10 + x] = 0;
  assert.equal(components(m, 10, 10).negativeSpaces, 1);
});
test("sampled symmetric distance includes a displaced terminal point", () => {
  const r = sampledBoundary(
    [
      [0, 0],
      [1, 0],
      [2, 0],
    ],
    [
      [0, 0],
      [1, 0],
      [2, 3],
    ],
  );
  assert.equal(r.max, 3);
  assert(r.p95 > 2);
});
test("intentional overlap between separate SVG faces is not called a self intersection", () => {
  const s =
    '<svg width="30" height="30"><path d="M0 0H20V20H0Z" fill="#111"/><path d="M10 10H30V30H10Z" fill="#222"/></svg>';
  assert.equal(svgComplexity(s).withinPathCrossings, 0);
  const bow =
    '<svg width="30" height="30"><path d="M1 1L20 20L1 20L20 1Z"/></svg>';
  assert(svgComplexity(bow).withinPathCrossings > 0);
});
