import type { Geometry } from "./curve-geometry-metrics.mjs";
export function structure(g: Geometry): {
  closed: number;
  properCrossings: number;
  acuteTurnCount: number;
  maxSmoothJoinRadians: number;
};
export function cornerMetrics(
  g: Geometry,
  reference: number[][],
): {
  precision: number;
  recall: number;
  unexpected: number;
  errors: number[];
  endpointBoundaryErrors: number[];
  endpointAnchorErrors: number[];
};
