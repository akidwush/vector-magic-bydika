import { it, expect } from "vitest";
import { sourcePalette } from "../../src/engine/palette";
it("keeps small dark features and alpha without mutating source", () => {
  const data = new Uint8ClampedArray(1000 * 4);
  for (let i = 0; i < 1000; i++)
    data.set(
      i < 10 ? [30, 40, 50, 255] : i < 200 ? [0, 0, 0, 0] : [223, 147, 94, 255],
      i * 4,
    );
  const before = data.slice();
  const pal = sourcePalette(data, 8);
  expect(data).toEqual(before);
  expect(pal).toContainEqual({ r: 30, g: 40, b: 50, a: 255 });
  expect(pal.some((p) => p.a === 0)).toBe(true);
  expect(pal.length).toBeLessThanOrEqual(8);
});
it("limits palette size for complex inputs", () => {
  const data = new Uint8ClampedArray(4096 * 4);
  for (let i = 0; i < 4096; i++)
    data.set([(i >> 8) * 16, ((i >> 4) & 15) * 16, (i & 15) * 16, 255], i * 4);
  expect(sourcePalette(data, 8).length).toBeLessThanOrEqual(8);
});
