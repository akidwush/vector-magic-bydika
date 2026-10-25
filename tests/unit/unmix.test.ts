import { expect, test } from "vitest";
import { boundaryMixModel } from "../../src/engine/transitions";
test("mixing evidence compares both hypotheses in encoded RGB and preserves ambiguity", () => {
  const a = [0.85, 0.12, 0.3],
    b = [0.1, 0.8, 0.95];
  const decode = (x: number) =>
    x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  const encode = (x: number) =>
    x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  for (const linear of [false, true]) {
    const colors = Array.from({ length: 19 }, (_, i) =>
      a.map((v, k) => {
        const t = (i + 1) / 20;
        const x = linear
          ? encode(t * decode(v) + (1 - t) * decode(b[k]))
          : t * v + (1 - t) * b[k];
        return Math.round(x * 255) / 255;
      }),
    );
    expect(boundaryMixModel(colors, a, b)).toBe(linear ? "linear" : "srgb");
  }
  expect(
    boundaryMixModel(Array(12).fill([0.5, 0.5, 0.5]), [1, 1, 1], [0, 0, 0]),
  ).toBeUndefined();
  expect(
    boundaryMixModel(Array(12).fill([0, 1, 0]), [1, 0, 0], [0, 0, 1]),
  ).toBeUndefined();
});
