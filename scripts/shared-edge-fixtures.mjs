// Original CC0 artwork generated for this project; no third-party image uploads.
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
const dir = "tests/fixtures/shared-edge";
await mkdir(dir, { recursive: true });
const cases = {
  curve: '<path fill="#2163d4" d="M64 0C20 30 108 78 64 128H128V0Z"/>',
  junction:
    '<path fill="#2163d4" d="M64 0V64H128V0Z"/><path fill="#32a852" d="M0 64H128V128H0Z"/>',
  organic:
    '<path fill="#2163d4" d="M20 114Q8 58 30 14L53 38Q64 32 76 38L99 14Q121 63 108 114Z"/><circle fill="#172e38" cx="48" cy="68" r="5"/><circle fill="#172e38" cx="81" cy="68" r="5"/><path fill="#172e38" d="M60 83L70 83L65 90Z"/>',
  rings:
    '<ellipse fill="#2163d4" cx="64" cy="64" rx="47.4" ry="39.6"/><ellipse fill="#e67a20" cx="64" cy="64" rx="26.3" ry="19.4"/><circle fill="#32a852" cx="64" cy="64" r="9.7"/>',
  rounded:
    '<rect fill="#2163d4" x="14.3" y="21.8" width="99.4" height="84.4" rx="19.4"/>',
  diagonal: '<path fill="#2163d4" d="M0 0H128V28.2L0 100.7Z"/>',
  thin: '<path fill="#2163d4" d="M14 24H65V62H116V65H65V103H14Z"/>',
  pinch: '<path fill="#2163d4" d="M0 0H64V64H0ZM64 64H128V128H64Z"/>',
};
for (const [name, body] of Object.entries(cases)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><path fill="#e67a20" d="M0 0H128V128H0Z"/>${body}</svg>`;
  await writeFile(`${dir}/${name}.svg`, svg);
  const raster = await sharp(Buffer.from(svg), { density: 288 })
    .png()
    .toBuffer();
  await sharp(raster).resize(128, 128).png().toFile(`${dir}/${name}.png`);
  if (name === "curve") {
    await sharp(raster)
      .resize(128, 128)
      .jpeg({ quality: 45 })
      .toFile(`${dir}/curve.jpg`);
    await sharp(raster)
      .resize(128, 128)
      .webp({ quality: 40 })
      .toFile(`${dir}/curve.webp`);
  }
}
await writeFile(
  `${dir}/README.md`,
  "# Shared-edge fixtures\n\nOriginal CC0 synthetic SVG ground truth. Regenerate PNG/JPEG/WebP with `node scripts/shared-edge-fixtures.mjs`. Fractional curves, organic face/ears/eyes/nose, nested holes/islands, junctions, corner pinch, rounded rectangle, diagonal, thin attached detail, lossy codecs.\n",
);
