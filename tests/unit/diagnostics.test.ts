import { it, expect } from "vitest";
import { analyzeInput, chooseProfile } from "../../src/engine/diagnostics";
it("classifies alpha and does not silently certify it", () => {
  const rgba = new Uint8ClampedArray([255, 0, 0, 128, 255, 0, 0, 255]);
  const before = rgba.slice();
  const d = analyzeInput({
    rgba,
    width: 2,
    height: 1,
    sourceFormat: "image/png",
  });
  expect(d.classification).toBe("partial-alpha");
  expect(d.alphaPartialFraction).toBe(0.5);
  expect(rgba).toEqual(before);
  expect(chooseProfile(d, "photo")).toBe("legacy");
  expect(chooseProfile(d, "illustration", "legacy")).toBe("legacy");
});
it("keeps sharp, compression noise, and complex sources distinct", () => {
  const rgba = new Uint8ClampedArray(64 * 4);
  for (let i = 0; i < 64; i++) rgba.set([230, 140, 90, 255], i * 4);
  const input = { rgba, width: 8, height: 8 };
  expect(
    analyzeInput({ ...input, sourceFormat: "image/png" }).classification,
  ).toBe("sharp-flat");
  expect(
    analyzeInput({ ...input, sourceFormat: "image/jpeg" }).classification,
  ).toBe("compressed-flat");
  const d = analyzeInput(input);
  expect(
    chooseProfile({ ...d, classification: "blended-flat" }, "illustration"),
  ).toBe("blend");
  expect(
    chooseProfile(
      { ...d, classification: "complex", dominantCoverage: 0.1 },
      "illustration",
    ),
  ).toBe("legacy");
});
