// Analytic fixtures verify metric extraction, not an engine quality claim.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { contour } from "./real-artwork-contours.mjs";
import { sampledBoundary } from "./real-artwork-metrics.mjs";
const browser = await chromium.launch({
  executablePath: process.env.NEXORA_CHROMIUM_PATH,
});
try {
  const p = await browser.newPage();
  for (const transformed of [false, true]) {
    const lo = 20,
      hi = transformed ? 50 : 80;
    const mask = Uint8Array.from({ length: 40000 }, (_, i) => {
      const x = ((i % 200) + 0.5) / 2,
        y = (Math.floor(i / 200) + 0.5) / 2;
      return x >= lo && x < hi && y >= lo && y < hi ? 1 : 0;
    });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g ${transformed ? 'transform="translate(1 1) scale(.5)"' : ""}><path d="M2 2H8V8H2Z"/></g></svg>`;
    const result = await contour(p, svg, 100, 100, mask);
    for (const expected of [
      [lo, lo],
      [hi, lo],
      [hi, hi],
      [lo, hi],
    ])
      assert(
        result.points.some(
          (q) => Math.hypot(q[0] - expected[0], q[1] - expected[1]) < 1e-8,
        ),
        "Exact transformed endpoint missing",
      );
    assert(result.endpoints >= 4);
    assert.equal(sampledBoundary(result.points, result.points).max, 0);
  }
  const mask = Uint8Array.from({ length: 40000 }, (_, i) => {
    const x = ((i % 200) + 0.5) / 2,
      y = (Math.floor(i / 200) + 0.5) / 2;
    return x >= 20 && x < 80 && y >= 20 && y < 80 ? 1 : 0;
  });
  const plain =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M20 20H80V80H20Z"/></svg>';
  const masked =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><mask id="m" maskUnits="userSpaceOnUse"><path d="M20 20H80V80H20Z" fill="white"/></mask></defs><g mask="url(#m)"><path d="M0 0H100V100H0Z"/></g></svg>';
  const a = await contour(p, plain, 100, 100, mask),
    b = await contour(p, masked, 100, 100, mask);
  assert(
    sampledBoundary(a.points, b.points).max < 0.01,
    "Mask-defined silhouette lost",
  );
  const clippedMask = Uint8Array.from({ length: 40000 }, (_, i) => {
    const x = ((i % 200) + 0.5) / 2,
      y = (Math.floor(i / 200) + 0.5) / 2;
    return x >= 20 && x < 80 && y >= 20 ? 1 : 0;
  });
  const clipped =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M20 20H80V100.2H20Z"/></svg>',
    trimmed = clipped.replace("100.2", "100");
  const c = await contour(p, clipped, 100, 100, clippedMask),
    d = await contour(p, trimmed, 100, 100, clippedMask);
  assert(
    sampledBoundary(c.points, d.points).max < 0.51,
    "Viewport clip edge lost",
  );
  console.log(
    "Browser contour extraction: viewBox, transformed endpoints, masks, viewport clips and identity PASS",
  );
} finally {
  await browser.close();
}
