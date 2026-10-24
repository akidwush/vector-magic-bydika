import { it, expect } from "vitest";
import { analyzeTransitions } from "../../src/engine/transitions";
it("keeps a genuine flat pink patch as interior evidence and does not rewrite pixels", () => {
  const w = 32,
    h = 24,
    data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      data.set(
        x < 10
          ? [255, 0, 0, 255]
          : x < 22
            ? [255, 128, 128, 255]
            : [255, 255, 255, 255],
        (y * w + x) * 4,
      );
  const before = data.slice();
  const evidence = analyzeTransitions({
    rgba: data,
    width: w,
    height: h,
    sourceFormat: "image/png",
  });
  expect(evidence.interior).toBeGreaterThan(150);
  expect(data).toEqual(before);
});
it("treats partial alpha separately from RGB coverage", () => {
  const data = new Uint8ClampedArray(16 * 16 * 4);
  for (let i = 0; i < 256; i++) data.set([200, 100, 50, 128], i * 4);
  expect(
    analyzeTransitions({ rgba: data, width: 16, height: 16 }).partialAlpha,
  ).toBeGreaterThan(0);
});
