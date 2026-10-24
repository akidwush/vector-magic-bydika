export interface GeometryMetrics {
  boundaryF1: number;
  symmetricContourDistance: number;
  silhouetteIoU: number;
  rgbRMSE: number;
  globalLumaSSIM: number;
  sampledDeltaE76: number;
  eyeIoU?: number[];
  eyeRadialCV?: number[];
  muzzleIoU?: number;
  earTipDistance?: number[];
}
export function geometryMetrics(
  gt: Uint8Array,
  out: Uint8Array,
  width: number,
  height: number,
  cat?: boolean,
): GeometryMetrics;
