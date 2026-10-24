import { sourcePalette } from "../src/engine/palette.ts";
/** Optional compression-interior cleanup. Never alters alpha or boundary pixels.
 * Requires all 3x3 neighbors to agree on the same source-derived palette color.
 */
export function paletteDenoise(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  strength = 12,
) {
  const palette = sourcePalette(rgba, 24).filter((p) => p.a === 255);
  if (!palette.length) return { rgba, changedPixels: 0 };
  const labels = new Uint8Array(width * height);
  labels.fill(255);
  for (let i = 0; i < labels.length; i++) {
    if (rgba[i * 4 + 3] !== 255) continue;
    let best = Infinity,
      index = 255;
    for (let k = 0; k < palette.length; k++) {
      const p = palette[k],
        d =
          (rgba[i * 4] - p.r) ** 2 +
          (rgba[i * 4 + 1] - p.g) ** 2 +
          (rgba[i * 4 + 2] - p.b) ** 2;
      if (d < best) {
        best = d;
        index = k;
      }
    }
    labels[i] = index;
  }
  let output: Uint8ClampedArray | undefined,
    changedPixels = 0;
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x,
        label = labels[i];
      if (label === 255) continue;
      let interior = true;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const j = (y + dy) * width + x + dx;
          if (labels[j] !== label || rgba[j * 4 + 3] !== 255) interior = false;
        }
      const p = palette[label],
        distance = Math.hypot(
          rgba[i * 4] - p.r,
          rgba[i * 4 + 1] - p.g,
          rgba[i * 4 + 2] - p.b,
        );
      if (interior && distance > 0 && distance <= strength) {
        output ??= rgba.slice();
        output.set([p.r, p.g, p.b], i * 4);
        changedPixels++;
      }
    }
  return { rgba: output ?? rgba, changedPixels };
}
