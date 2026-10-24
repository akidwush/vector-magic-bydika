export function metrics(
  source: ArrayLike<number>,
  output: ArrayLike<number>,
  width: number,
  height: number,
  opaque?: boolean,
): {
  earsConnected: boolean;
  iou: number;
  mae: number;
  alphaMae: number;
  interiorBad: number;
  maxHole: number;
  holes: number;
  details: boolean[];
};
export function stats(rgba: ArrayLike<number>): {
  uniqueRGB: number;
  zeroAlpha: number;
  partialAlpha: number;
};
