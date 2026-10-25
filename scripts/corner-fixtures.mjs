import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
const dir = "tests/fixtures/corners";
await mkdir(dir, { recursive: true });
const cases = {
  square: {
    d: "M24 24H104V104H24Z",
    corners: [
      [24, 24],
      [104, 24],
      [104, 104],
      [24, 104],
    ],
  },
  triangle: {
    d: "M64 12L116 110H12Z",
    corners: [
      [64, 12],
      [116, 110],
      [12, 110],
    ],
  },
  star: {
    d: "M64 10L76 46L114 46L84 69L96 108L64 84L32 108L44 69L14 46L52 46Z",
    corners: [
      [64, 10],
      [76, 46],
      [114, 46],
      [84, 69],
      [96, 108],
      [64, 84],
      [32, 108],
      [44, 69],
      [14, 46],
      [52, 46],
    ],
  },
  hair: {
    d: "M16 112L22 44L38 15L42 47L66 8L69 42L101 18L92 53L116 43Q123 88 106 112Z",
    corners: [
      [16, 112],
      [22, 44],
      [38, 15],
      [42, 47],
      [66, 8],
      [69, 42],
      [101, 18],
      [92, 53],
      [116, 43],
    ],
  },
  mixed: {
    d: "M20 108V64A44 44 0 0 1 108 64V108Z",
    corners: [
      [20, 108],
      [108, 108],
    ],
  },
};
for (const [name, c] of Object.entries(cases)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><path fill="#e67a20" d="M0 0H128V128H0Z"/><path fill="#2163d4" d="${c.d}"/></svg>`;
  await writeFile(`${dir}/${name}.svg`, svg);
  for (const size of [64, 128, 512]) {
    const png = await sharp(Buffer.from(svg), { density: 288 })
      .resize(size, size)
      .png()
      .toBuffer();
    await writeFile(`${dir}/${name}-${size}.png`, png);
    if (size === 128) {
      await sharp(png).jpeg({ quality: 45 }).toFile(`${dir}/${name}.jpg`);
      await sharp(png).webp({ quality: 40 }).toFile(`${dir}/${name}.webp`);
    }
  }
}
await writeFile(`${dir}/truth.json`, JSON.stringify(cases, null, 2));
await writeFile(
  `${dir}/README.md`,
  "Original CC0 artwork. Regenerate with node scripts/corner-fixtures.mjs. Coordinates in truth.json use a 128px canvas.\n",
);
