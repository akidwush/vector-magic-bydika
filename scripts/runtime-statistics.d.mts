export interface Distribution {
  n: number;
  min: number;
  median: number;
  p95: number;
  max: number;
  mean: number;
  variance: number;
  mad: number;
}
export function distribution(values: number[]): Distribution | null;
