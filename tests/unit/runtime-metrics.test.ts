import { describe, it, expect } from "vitest";
import { distribution } from "../../scripts/runtime-statistics.mjs";
describe("independent runtime distributions", () => {
  it("retains large outliers and uses the ordinary even median", () => {
    const input = [20, 10000, 10, 30];
    const r = distribution(input)!;
    expect(r.n).toBe(4);
    expect(r.median).toBe(25);
    expect(r.max).toBe(10000);
    expect(r.mad).toBe(10);
    expect(r.p95).toBe(10000);
    expect(input).toEqual([20, 10000, 10, 30]);
  });
  it("reports empty observations as unavailable", () => {
    expect(distribution([])).toBeNull();
  });
  it("uses nearest-rank p95 and positive dispersion", () => {
    const r = distribution(Array.from({ length: 20 }, (_, i) => i + 1))!;
    expect(r.p95).toBe(19);
    expect(r.median).toBe(10.5);
    expect(r.variance).toBeGreaterThan(0);
    expect(r.mad).toBeGreaterThan(0);
  });
});
