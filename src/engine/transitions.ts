import type { TraceInput } from "./types";
export interface TransitionEvidence {
  sampled: number;
  interior: number;
  twoColorEdges: number;
  thirdOrAmbiguous: number;
  compressionResidual: number;
  partialAlpha: number;
  directionRejected: number;
}
/** Local evidence only; does not declare that a particular hue is antialiasing. */
export function analyzeTransitions({
  rgba,
  width,
  height,
  sourceFormat,
}: TraceInput): TransitionEvidence {
  const result = {
    sampled: 0,
    interior: 0,
    twoColorEdges: 0,
    thirdOrAmbiguous: 0,
    compressionResidual: 0,
    partialAlpha: 0,
    directionRejected: 0,
  };
  const step = Math.max(1, Math.ceil(Math.sqrt((width * height) / 8192)));
  const color = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return [rgba[i], rgba[i + 1], rgba[i + 2]];
  };
  const dist = (a: number[], b: number[]) =>
    Math.hypot(...a.map((v, k) => v - b[k]));
  for (let y = 3; y < height - 3; y += step)
    for (let x = 3; x < width - 3; x += step) {
      result.sampled++;
      const alpha = rgba[(y * width + x) * 4 + 3];
      if (alpha > 0 && alpha < 255) {
        result.partialAlpha++;
        continue;
      }
      if (!alpha) continue;
      const c = color(x, y),
        neighbors = [
          color(x - 1, y),
          color(x + 1, y),
          color(x, y - 1),
          color(x, y + 1),
        ];
      if (neighbors.every((p) => dist(c, p) < 6)) {
        result.interior++;
        continue;
      }
      const horizontal =
        dist(color(x - 2, y), color(x + 2, y)) >=
        dist(color(x, y - 2), color(x, y + 2));
      const axis = (s: number, t: number) =>
        horizontal ? color(x + s, y + t) : color(x + t, y + s);
      const a = axis(-2, 0),
        b = axis(2, 0),
        d = a.map((v, k) => v - b[k]),
        norm = d.reduce((s, v) => s + v * v, 0);
      if (
        norm < 32 ** 2 ||
        [-1, 1].some(
          (t) => dist(axis(-2, t), a) > 12 || dist(axis(2, t), b) > 12,
        )
      ) {
        result.thirdOrAmbiguous++;
        continue;
      }
      const coverage = (p: number[]) =>
        p.reduce((s, v, k) => s + (v - b[k]) * d[k], 0) / norm;
      const t = coverage(c),
        residual = dist(
          c,
          b.map((v, k) => v + t * d[k]),
        );
      const directional = [-1, 0, 1].map(
        (offset) => coverage(axis(1, offset)) - coverage(axis(-1, offset)),
      );
      if (directional.some((v) => v > -0.1)) {
        result.directionRejected++;
        continue;
      }
      if (t > 0.05 && t < 0.95 && residual < 10) {
        result.twoColorEdges++;
      } else {
        result.thirdOrAmbiguous++;
        if (/jpeg|webp/.test(sourceFormat ?? "") && residual >= 10)
          result.compressionResidual++;
      }
    }
  return result;
}

/** Diagnostic only: colour-line membership alone never authorizes relabeling. */
export function boundaryMixModel(
  colors: number[][],
  a: number[],
  b: number[],
): "srgb" | "linear" | undefined {
  const decode = (x: number) =>
    x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  const encode = (x: number) =>
    x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  if (
    [a, b, ...colors].some(
      (c) =>
        c.length !== 3 || c.some((x) => !Number.isFinite(x) || x < 0 || x > 1),
    )
  )
    return undefined;
  const errors = [0, 0];
  let count = 0;
  for (const c of colors) {
    const fits = [false, true].map((linear) => {
      const u = linear ? a.map(decode) : a,
        v = linear ? b.map(decode) : b;
      const p = linear ? c.map(decode) : c,
        d = u.map((x, k) => x - v[k]);
      const norm = d.reduce((s, x) => s + x * x, 0);
      if (norm < 1e-6) return undefined;
      const t = p.reduce((s, x, k) => s + (x - v[k]) * d[k], 0) / norm;
      if (t < -0.08 || t > 1.08) return undefined;
      const coverage = Math.max(0, Math.min(1, t));
      const error = v.reduce((s, x, k) => {
        const mixed = x + coverage * d[k];
        return s + ((linear ? encode(mixed) : mixed) - c[k]) ** 2;
      }, 0);
      return { coverage, error };
    });
    if (!fits[0] || !fits[1]) return undefined;
    if (fits.every((f) => f!.coverage > 0.02 && f!.coverage < 0.98)) {
      errors[0] += fits[0].error;
      errors[1] += fits[1].error;
      count++;
    }
  }
  if (count < 8) return undefined;
  const [s, l] = errors.map((e) => e / count),
    floor = 3 / (255 * 255);
  if (Math.min(s, l) > floor || Math.abs(s - l) < floor) return undefined;
  return l < s * 0.5 ? "linear" : s < l * 0.5 ? "srgb" : undefined;
}
