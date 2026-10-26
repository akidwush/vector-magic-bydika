// Original CC0 holdouts. Each resolution is rasterized from vector ground truth.
// The optimizer never receives these references or another input resolution.
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
const root = "tests/fixtures/acute-geometry";
await mkdir(root, { recursive: true });
const a = [49, 101, 193],
  b = [255, 255, 255];
const hex = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const encoded = (c) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
const transform = (commands, degrees, shift = [0, 0], scale = 1) => {
  const co = Math.cos((degrees * Math.PI) / 180),
    sn = Math.sin((degrees * Math.PI) / 180);
  return commands
    .map(
      ([op, ...pts]) =>
        op +
        pts
          .map(([x, y]) => {
            x = (x - 128) * scale;
            y = (y - 128) * scale;
            return [
              128 + x * co - y * sn + shift[0],
              128 + x * sn + y * co + shift[1],
            ].join(" ");
          })
          .join(" "),
    )
    .join("");
};
const blade = (tip, handle) => [
  ["M", [31, 202]],
  ["C", [43, 8], handle, tip],
  ["L", [226, 219]],
  ["L", [31, 219]],
  ["Z"],
];
const triangle = (angle) => {
  const w = 166 * Math.tan((angle * Math.PI) / 360);
  return [
    ["M", [128, 32]],
    ["L", [128 + w, 198]],
    ["L", [128 - w, 198]],
    ["Z"],
  ];
};
const k = 0.5522847498307936;
const ellipse = [
  ["M", [224, 128]],
  ["C", [224, 128 + k * 13], [128 + k * 96, 141], [128, 141]],
  ["C", [128 - k * 96, 141], [32, 128 + k * 13], [32, 128]],
  ["C", [32, 128 - k * 13], [128 - k * 96, 115], [128, 115]],
  ["C", [128 + k * 96, 115], [224, 128 - k * 13], [224, 128]],
  ["Z"],
];
const shapes = [
  ["blade-narrow", blade([226, 54], [209, 231]), 0, [0.37, -0.23], 1],
  ["blade-rotated", blade([222, 59], [177, 221]), 27, [-0.31, 0.43], 0.86],
  ["blade-oblique", blade([220, 63], [185, 217]), 68, [0.19, 0.37], 0.85],
  ["triangle-eight", triangle(8), -19, [0.37, 0.21], 1],
  ["triangle-twentyeight", triangle(28), 34, [-0.27, 0.41], 1],
  ["parallel-uncertain", triangle(2), 17, [0.37, 0.21], 1],
  [
    "rounded-blade",
    [
      ["M", [30, 198]],
      ["C", [38, 58], [173, 236], [213, 64]],
      ["C", [214.3, 58.5], [217, 58], [217.4, 64]],
      ["C", [219.4, 94], [219, 159], [220, 216]],
      ["L", [30, 216]],
      ["Z"],
    ],
    0,
    [0.23, 0.31],
    1,
  ],
  ["thin-ellipse", ellipse, 23, [0.37, -0.19], 1],
  ["clipped-blade", blade([226, 54], [209, 231]), 0, [42.37, -0.23], 1],
];
const manifest = [];
for (const [name, commands, rotation, shift, scale] of shapes) {
  const d = transform(commands, rotation, shift, scale);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" fill="${hex(b)}"/><path d="${d}" fill="${hex(a)}"/></svg>`;
  await writeFile(`${root}/${name}.svg`, svg);
  const modes = ["native-srgb"];
  if (name === "blade-narrow") modes.push("box4-srgb", "box4-linear");
  if (name === "blade-rotated") modes.push("box4-linear-noise");
  if (name === "rounded-blade") modes.push("box4-linear");
  for (const mode of modes)
    for (const size of [128, 512, 1024]) {
      const filename = `${name}-${mode}-${size}.png`;
      if (mode === "native-srgb") {
        await sharp(Buffer.from(svg), { density: (72 * size) / 256 })
          .png()
          .toFile(`${root}/${filename}`);
      } else {
        const mask = svg
          .replace(`fill="${hex(b)}"`, 'fill="white"')
          .replace(`fill="${hex(a)}"`, 'fill="black"');
        const raw = await sharp(Buffer.from(mask), {
          density: ((72 * size) / 256) * 4,
        })
          .greyscale()
          .raw()
          .toBuffer();
        const rgba = Buffer.alloc(size * size * 4),
          w = size * 4;
        for (let y = 0; y < size; y++)
          for (let x = 0; x < size; x++) {
            let sum = 0;
            for (let dy = 0; dy < 4; dy++)
              for (let dx = 0; dx < 4; dx++)
                sum += raw[(y * 4 + dy) * w + x * 4 + dx];
            const coverage = 1 - sum / (16 * 255),
              i = (y * size + x) * 4;
            for (let c = 0; c < 3; c++) {
              const value = mode.includes("linear")
                ? encoded(
                    coverage * linear(a[c] / 255) +
                      (1 - coverage) * linear(b[c] / 255),
                  )
                : (coverage * a[c] + (1 - coverage) * b[c]) / 255;
              const noise = mode.endsWith("noise")
                ? ((x * 17 + y * 31 + c * 7 + size) % 3) - 1
                : 0;
              rgba[i + c] = Math.max(
                0,
                Math.min(255, Math.round(value * 255) + noise),
              );
            }
            rgba[i + 3] = 255;
          }
        await sharp(rgba, { raw: { width: size, height: size, channels: 4 } })
          .png()
          .toFile(`${root}/${filename}`);
      }
      manifest.push({
        name,
        filename,
        reference: name + ".svg",
        width: size,
        height: size,
        mode,
        rotation,
        shift,
        clipped: name.startsWith("clipped"),
        expectedUncertain: name === "parallel-uncertain",
      });
    }
}
await writeFile(
  root + "/manifest.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
await writeFile(
  root + "/README.md",
  "Original CC0 project geometry generated by scripts/acute-geometry-fixtures.mjs. Native SVG rasterization and independently oversampled 4×4 box integration are separate source models. Linear-light variants use the exact sRGB transfer. Source RGB noise is deterministic ±1 byte/channel. Each 128/512/1024 image comes directly from its vector reference; another resolution is never an inference input. References are offline measurements only. Rounded and nearly parallel shapes are uncertainty holdouts, not sharp-corner targets.\n",
);
console.log(`Generated ${manifest.length} original cross-resolution holdouts.`);
