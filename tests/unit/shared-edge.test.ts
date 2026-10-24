import { describe, it, expect } from "vitest";
import { coincidence } from "../../scripts/shared-edge-metrics.mjs";
describe("serialized shared edges", () => {
  it("matches exact reversed cubics across absolute and relative commands", () => {
    const svg =
      '<svg><path d="M0 0L64 0C20 30 108 78 64 128L0 128Z"/><path d="M64 128c44 -50 -44 -98 0 -128L128 0L128 128Z"/></svg>';
    expect(coincidence(svg).unmatchedInterior).toBe(0);
    expect(coincidence(svg).coincidence).toBe(1);
  });
  it("detects a real mismatched shared curve rather than accepting nearby geometry", () => {
    const svg =
      '<svg><path d="M0 0L64 0C20 30 108 78 64 128L0 128Z"/><path d="M64 128C108.01 78 20 30 64 0L128 0L128 128Z"/></svg>';
    expect(coincidence(svg).unmatchedInterior).toBe(2);
  });
});
