import type { TraceInput } from "./types";
export interface InputDiagnostics {
  alphaZeroFraction: number;
  alphaPartialFraction: number;
  dominantColors: number;
  dominantCoverage: number;
  edgeBlendScore: number;
  noiseScore: number;
  classification:
    | "sharp-flat"
    | "blended-flat"
    | "compressed-flat"
    | "complex"
    | "partial-alpha";
  width: number;
  height: number;
  megapixels: number;
  sourceFormat: string;
}
/** Non-destructive statistics. Classification is heuristic, not semantic recognition. */
export function analyzeInput(input: TraceInput): InputDiagnostics {
  const { rgba, width, height } = input,
    bins = new Uint32Array(4096);
  let zero = 0,
    partial = 0,
    low = 0,
    edge = 0,
    small = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3];
    if (!a) zero++;
    else if (a < 255) partial++;
    if (a)
      bins[
        ((rgba[i] >> 4) << 8) | ((rgba[i + 1] >> 4) << 4) | (rgba[i + 2] >> 4)
      ]++;
    if ((i / 4) % width !== 0 && a && rgba[i - 1]) {
      const d = Math.max(
        Math.abs(rgba[i] - rgba[i - 4]),
        Math.abs(rgba[i + 1] - rgba[i - 3]),
        Math.abs(rgba[i + 2] - rgba[i - 2]),
      );
      if (d > 0) {
        edge++;
        if (d <= 32) low++;
        if (d <= 8) small++;
      }
    }
  }
  const count = width * height,
    visible = count - zero,
    sorted = bins.slice().sort().reverse();
  let sum = 0,
    colors = 0;
  for (const n of sorted) {
    if (!n) break;
    sum += n;
    colors++;
    if (sum >= visible * 0.95) break;
  }
  const coverage =
      sorted.slice(0, 8).reduce((a, b) => a + b, 0) / Math.max(1, visible),
    format = input.sourceFormat ?? "unknown";
  const flat = coverage >= 0.85;
  const classification = partial
    ? "partial-alpha"
    : !flat
      ? "complex"
      : /jpeg|webp/.test(format)
        ? "compressed-flat"
        : low / Math.max(1, edge) > 0.65
          ? "blended-flat"
          : "sharp-flat";
  return {
    alphaZeroFraction: zero / count,
    alphaPartialFraction: partial / count,
    dominantColors: colors,
    dominantCoverage: coverage,
    edgeBlendScore: low / Math.max(1, edge),
    noiseScore: small / Math.max(1, edge),
    classification,
    width,
    height,
    megapixels: count / 1e6,
    sourceFormat: format,
  };
}
/** Conservative default: modeled flat PNG, with local source checks in Rust.
 * Actual partial alpha bypasses decontamination and keeps the vector opacity route. */
export function canReconstruct(d: InputDiagnostics): boolean {
  return (
    d.sourceFormat === "image/png" &&
    d.dominantCoverage >= 0.96 &&
    d.dominantColors <= 8 &&
    ["sharp-flat", "blended-flat", "partial-alpha"].includes(d.classification)
  );
}
export function chooseProfile(
  d: InputDiagnostics,
  preset: string,
  quality:
    | "auto"
    | "legacy"
    | "shared"
    | "previous"
    | "pre-source"
    | "planar"
    | "source"
    | "intelligent" = "auto",
):
  | "adaptive"
  | "shared"
  | "legacy"
  | "blend"
  | "planar"
  | "source"
  | "intelligent" {
  if (preset === "photo") return "legacy";
  if (quality === "source" || (quality === "auto" && canReconstruct(d)))
    return "source";
  if (quality === "intelligent") return "intelligent";
  if (quality === "planar") return "planar";
  if (quality === "legacy" || preset === "photo") return "legacy";
  if (quality === "shared") return "shared";
  if (d.classification === "blended-flat" && d.alphaZeroFraction === 0)
    return "blend";
  return d.dominantCoverage >= 0.85 ? "adaptive" : "legacy";
}
