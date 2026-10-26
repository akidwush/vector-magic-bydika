export interface Geometry {
  width: number;
  height: number;
  paths: Array<{
    d: string;
    anchors: number;
    curves: number;
    lines: number;
    closed: number;
    subpaths: number[][][];
    edges: number[][][];
  }>;
  anchors: number;
  curves: number;
  lines: number;
  closed: number;
  controls: number;
  bytes: number;
}
export function geometry(svg: string): Geometry;
export function chains(g: Geometry): number[][][];
export function boundary(
  a: number[][][],
  b: number[][][],
): { mean: number; p95: number; max: number };
export function corners(g: Geometry): number[][];
export function pointBoundaryDistance(p: number[], cs: number[][][]): number;
export function worstBoundary(
  a: number[][][],
  b: number[][][],
): { distance: number; point: number[]; direction: string };
