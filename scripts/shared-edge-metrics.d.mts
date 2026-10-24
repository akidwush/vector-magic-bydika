import type { Page } from "@playwright/test";
export function coincidence(
  svg: string,
  w?: number,
  h?: number,
): {
  paths: number;
  primitives: number;
  interiorPrimitives: number;
  paired: number;
  unmatchedInterior: number;
  coincidence: number;
};
export function coverageMetrics(
  page: Page,
  svg: string,
  w?: number,
  h?: number,
): Promise<{
  geometricGapSamples: number;
  geometricOverlapSamples: number;
  total: number;
  boundarySamples: number;
  renderer: { scale: number; seamPixels: number; maxAlphaDeficit: number }[];
}>;
export function organicFeatures(
  source: ArrayLike<number>,
  output: ArrayLike<number>,
): number[];
