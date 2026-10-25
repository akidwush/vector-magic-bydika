import { expect, test } from "vitest";
import {
  geometry,
  chains,
  boundary,
} from "../../scripts/curve-geometry-metrics.mjs";
const svg = (d: string) =>
  `<svg width="100" height="100"><path d="${d}"/></svg>`;
test("geometry metric ignores the speed and syntax of identical line loci", () => {
  const c = geometry(svg("M10 20C10 20 90 20 90 20L90 80L10 80Z"));
  const l = geometry(svg("M10 20H90V80H10Z"));
  expect(c.anchors).toBe(4);
  expect(l.anchors).toBe(4);
  expect(c.controls).toBe(2);
  expect(l.controls).toBe(0);
  expect(boundary(chains(c), chains(l)).max).toBeLessThan(1e-9);
});
test("reverse boundary distance exposes unsupported bulges", () => {
  const a = geometry(svg("M10 20L90 20"));
  const b = geometry(svg("M10 20C10 90 90 90 90 20"));
  const error = boundary(chains(a), chains(b));
  expect(error.max).toBeGreaterThan(40);
  expect(error.mean).toBeGreaterThan(10);
});
test("semantic nodes count shorthand cubics and exclude duplicate closing anchor", () => {
  const g = geometry(svg("M10 50C10 10 90 10 90 50S10 90 10 50Z"));
  expect(g.anchors).toBe(2);
  expect(g.curves).toBe(2);
  expect(g.controls).toBe(4);
  expect(g.closed).toBe(1);
});
