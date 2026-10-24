/** Deterministic source palette initialization for ImageTracerJS, not a tracer.
 * Aggregate coarse RGBA histogram bins so grid sampling cannot miss small eyes.
 * Pixels, resolution and alpha are never rewritten. Photo keeps upstream sampling.
 */
export function sourcePalette(rgba: Uint8ClampedArray, limit: number) {
  const bins = new Map<
    number,
    { r: number; g: number; b: number; a: number; n: number }
  >();
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3],
      r = a ? rgba[i] : 0,
      g = a ? rgba[i + 1] : 0,
      b = a ? rgba[i + 2] : 0;
    const key = ((r >> 4) << 9) | ((g >> 4) << 5) | ((b >> 4) << 1) | (a >> 7);
    const p = bins.get(key) ?? { r: 0, g: 0, b: 0, a: 0, n: 0 };
    p.r += r;
    p.g += g;
    p.b += b;
    p.a += a;
    p.n++;
    bins.set(key, p);
  }
  const remaining = [...bins.values()]
    .sort((a, b) => b.n - a.n)
    .map((p) => ({
      ...p,
      r: p.r / p.n,
      g: p.g / p.n,
      b: p.b / p.n,
      a: p.a / p.n,
    }));
  const palette: { r: number; g: number; b: number; a: number }[] = [];
  while (remaining.length && palette.length < limit) {
    const p = remaining.shift()!;
    let n = p.n,
      r = p.r * n,
      g = p.g * n,
      b = p.b * n,
      a = p.a * n;
    for (let j = remaining.length - 1; j >= 0; j--) {
      const q = remaining[j];
      if (
        (p.r - q.r) ** 2 +
          (p.g - q.g) ** 2 +
          (p.b - q.b) ** 2 +
          (p.a - q.a) ** 2 <
        48 ** 2
      ) {
        n += q.n;
        r += q.r * q.n;
        g += q.g * q.n;
        b += q.b * q.n;
        a += q.a * q.n;
        remaining.splice(j, 1);
      }
    }
    if (n >= (rgba.length / 4) * 0.005 || palette.length === 0)
      palette.push({
        r: Math.round(r / n),
        g: Math.round(g / n),
        b: Math.round(b / n),
        a: Math.round(a / n),
      });
  }
  return palette;
}
