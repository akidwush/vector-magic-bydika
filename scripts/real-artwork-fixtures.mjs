// Original artwork is CC0-1.0. External SVGs retain the licenses in the manifest.
// Offline deterministic regeneration; never uses engine output or quality scores.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";
const root = "tests/fixtures/real-artwork";
const hash = (b) => createHash("sha256").update(b).digest("hex");
const wrap = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">${body}</svg>`;
const path = (d, fill, extra = "") =>
  `<path d="${d}" fill="${fill}" ${extra}/>`;
const circle = (x, y, r, fill) =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`;
const line = (d, color = "#252440", width = 1) =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`;
const hair = "#242943",
  skin = "#efb59c";
function portrait(side = false) {
  let s =
    path("M16 127 Q18 98 45 96 L84 96 Q112 100 116 127Z", "#38699d") +
    path("M49 84 L48 104 Q64 119 80 104 L78 82Z", skin) +
    path("M50 97 L64 110 78 98 84 113 67 127 43 113Z", "#f3e0bd");
  s += path(
    "M17 86 Q6 55 21 24 Q43 -2 75 10 Q111 9 117 50 L109 101 86 94 38 100Z",
    hair,
  );
  s += path(
    "M30 45 C22 65 28 89 48 99 Q64 111 83 97 C105 86 109 61 98 36 Q64 14 30 45Z",
    skin,
  );
  s += path(
    "M31 67 Q24 58 22 67 Q21 79 33 80 M98 65 Q106 58 109 67 Q110 80 97 80",
    skin,
  );
  for (const [x, flip] of [
    [39, 1],
    [87, -1],
  ]) {
    s +=
      `<g transform="translate(${x} 65) scale(${flip} 1)">` +
      path("M-11 0 Q-4 -10 9 -2 Q8 9 -2 9 Q-8 8 -11 0Z", "#fff8ed");
    s +=
      `<ellipse cx="0" cy="1" rx="5" ry="7" fill="#4e8e99"/>` +
      circle(0, 1, 2.4, "#151b30") +
      circle(-1.2, -1.4, 1.3, "white") +
      circle(2, 4, 0.65, "#bde5df") +
      line("M-12 -1 Q-4 -10 10 -3", "#252440", 1.8) +
      line("M-11 -1 L-14 -4 M-8 -4 L-10 -7", "#252440", 1.1) +
      "</g>";
  }
  s +=
    line("M33 52 Q41 47 49 51 M78 50 Q87 46 94 51", "#49333d", 1.5) +
    line("M64 65 L61 78 65 80", "#a96761", 0.8) +
    path("M55 88 Q64 93 74 87 Q66 97 55 88Z", "#bd6472");
  s += `<ellipse cx="38" cy="81" rx="8" ry="2.6" fill="#df8f8e"/><ellipse cx="91" cy="81" rx="8" ry="2.6" fill="#df8f8e"/>`;
  for (let i = 0; i < 13; i++) {
    const x = 19 + i * 7,
      dx = side ? (i % 3) * 4 : 0,
      y = 20 + (i % 4) * 3;
    s += path(
      `M${x} ${y} Q${x + 11} 15 ${x + 16} ${31 + (i % 3) * 4} L${x + 9 + dx} ${53 + (i % 3) * 6} Q${x + 6} 34 ${x - 3} ${38 + (i % 2) * 9}Z`,
      i % 3 ? "#303751" : "#39435e",
    );
  }
  for (let i = 0; i < 7; i++)
    s += line(
      `M${20 + i * 14} ${25 + (i % 3) * 4} Q${24 + i * 13} 34 ${26 + i * 13} ${41 + (i % 2) * 4}`,
      "#66718b",
      0.65,
    );
  for (const x of [25, 102])
    s +=
      circle(x, 81, 2.2, "#e5bd60") +
      path(`M${x} 84 L${x - 2} 91 ${x} 94 ${x + 2} 91Z`, "#5aa6a4");
  for (let i = 0; i < 5; i++)
    s += circle(60 + i, 116 + i * 1.5, 0.8, "#d6dce7");
  s += line("M22 117 Q31 108 36 126 M92 127 Q102 106 110 118", "#23496f", 1.1);
  if (side)
    s +=
      path("M15 31 Q46 5 101 27 L114 37 Q60 26 14 44Z", "#ac455e") +
      path("M50 9 Q76 -4 94 17 L101 28 Q77 23 40 28Z", "#c46176") +
      path("M90 25 L110 17 114 31 96 33Z", "#e8c37b") +
      circle(101, 26, 3, "#796e9a");
  return wrap(s);
}
let garden = path(
  "M7 106 Q15 82 32 92 Q42 71 60 89 Q88 66 122 101 L122 119 6 119Z",
  "#d7e0cc",
);
for (let pot = 0; pot < 7; pot++) {
  const x = 12 + pot * 16,
    y = 95 + (pot % 3) * 7;
  garden += path(
    `M${x - 5} ${y} L${x + 9} ${y} ${x + 7} ${y + 20} ${x - 3} ${y + 20}Z`,
    ["#a65e4b", "#637e9d", "#bc8e52"][pot % 3],
  );
  garden += line(
    `M${x + 2} ${y + 2} Q${x - 1} ${y - 15} ${x + 3} ${y - 37}`,
    "#426d5b",
    1.2,
  );
  for (let j = 0; j < 6; j++) {
    const yy = y - 5 - j * 5,
      dir = j % 2 ? 1 : -1;
    garden += path(
      `M${x + 2} ${yy} Q${x + dir * 14} ${yy - 13} ${x + dir * 12} ${yy - 1} Q${x + dir * 8} ${yy + 5} ${x + 2} ${yy}Z`,
      ["#73985e", "#426d5b", "#89a884"][(j + pot) % 3],
    );
    garden += line(
      `M${x + 2} ${yy} L${x + dir * 9} ${yy - 4}`,
      "#b3c795",
      0.45,
    );
  }
  if (pot % 2 === 0)
    for (let i = 0; i < 5; i++) {
      const xx = x + 3 + Math.cos(i * 1.256) * 4,
        yy = y - 38 + Math.sin(i * 1.256) * 4;
      garden += circle(xx, yy, 3.1, pot % 4 ? "#cf9978" : "#b66a7b");
    }
  garden += circle(x + 3, y - 38, 1.5, "#e4c373");
}
garden +=
  line("M5 120 L124 120", "#616772", 1) +
  path("M9 12 Q30 3 49 15 L44 31 Q24 21 9 32Z", "#f1d9ac");
for (let i = 0; i < 8; i++)
  garden += circle(66 + i * 6, 17 + (i % 3) * 7, 0.65, "#af8875");
const compassPoints = Array.from({ length: 16 }, (_, i) => {
  const a = (i * Math.PI) / 8 - Math.PI / 2,
    r = i % 2 ? 22 : i % 4 === 0 ? 53 : 38;
  return [64 + Math.cos(a) * r, 64 + Math.sin(a) * r];
});
const cp = compassPoints.map((p) => p.map((v) => +v.toFixed(5)));
const compass = wrap(
  path(
    "M" +
      cp.map((p) => p.join(" ")).join("L") +
      "Z M64 48 C42 48 42 80 64 80 C86 80 86 48 64 48Z",
    "#274b69",
    'fill-rule="evenodd"',
  ) + circle(64, 64, 7, "#c2834f"),
);
const ribbon = wrap(
  path(
    "M11 36 Q11 19 28 19 L100 19 Q117 19 117 36 L117 52 98 52 98 40 32 40 32 88 50 88 50 109 28 109 Q11 109 11 92Z",
    "#225a75",
  ) +
    path(
      "M45 48 Q45 32 61 32 L85 32 85 53 66 53 66 88 111 88 111 109 61 109 Q45 109 45 93Z",
      "#ce855a",
    ) +
    path("M85 71 L117 71 117 52 98 52 98 57 85 57Z", "#225a75"),
);
const glyphs = {
  O: "M10 0C-4 0-4 30 10 30C24 30 24 0 10 0Z M10 6C16 6 16 24 10 24C4 24 4 6 10 6Z",
  B: "M0 0L12 0C24 0 24 13 16 15C26 17 24 30 12 30L0 30Z M6 5L6 12 11 12C17 12 17 5 11 5Z M6 18L6 25 12 25C18 25 18 18 12 18Z",
  N: "M0 30L0 0 6 0 16 19 16 0 22 0 22 30 16 30 6 11 6 30Z",
  8: "M10 0C23 0 23 11 16 14C26 20 23 31 10 31C-3 31-6 20 4 14C-3 11-3 0 10 0Z M10 5C4 5 4 11 10 11C16 11 16 5 10 5Z M10 18C3 18 3 25 10 25C17 25 17 18 10 18Z",
  a: "M18 8L24 8 24 30 18 30 18 27C3 38-8 15 7 8Q13 5 18 11Z M13 13C4 13 4 25 13 25C21 25 21 13 13 13Z",
  e: "M22 21L5 21Q8 32 18 24L22 28C7 39-7 24 0 13C7 1 24 8 22 21Z M5 16L17 16Q12 8 5 16Z",
};
let signage = "";
for (const [i, g] of ["N", "O", "B", "8", "a", "e"].entries())
  signage += `<g transform="translate(${8 + (i % 3) * 39} ${17 + Math.floor(i / 3) * 51}) scale(1.25)">${path(glyphs[g], "#273148", 'fill-rule="evenodd"')}</g>`;
let symbols = "";
for (let i = 0; i < 24; i++)
  symbols += `<g transform="translate(${6 + (i % 6) * 20} ${10 + Math.floor(i / 6) * 29}) scale(.52)">${path(glyphs[["O", "B", "8", "a", "e", "N"][i % 6]], i % 2 ? "#3b5d74" : "#6f5577", 'fill-rule="evenodd"')}</g>`;
symbols += line(
  "M8 125C18 112 29 112 35 120C41 128 53 128 61 116 M75 119L85 119 M80 114L80 124",
  "#425a61",
  0.65,
);
const originals = {
  ribbon: ribbon,
  compass: compass,
  anime: portrait(),
  "anime-side": portrait(true),
  garden: wrap(garden),
  signage: wrap(signage),
  "small-symbols": wrap(symbols),
};
for (const [name, svg] of Object.entries(originals))
  await writeFile(root + "/references/original-" + name + ".svg", svg);
const rows = [];
const add = (family, category, sizes, extra = {}) => {
  for (const size of sizes)
    rows.push({
      id: `${family}-${size}${extra.variant ? "-" + extra.variant : ""}`,
      family,
      category,
      size,
      ...extra,
    });
};
add("original-ribbon", "logo-icon", [128, 512]);
add("original-compass", "logo-icon", [128, 512, 1024]);
add("twemoji-palette", "logo-icon", [512]);
add("twemoji-cat", "cartoon", [128, 512]);
for (const name of ["fox", "woman", "unicorn"])
  add("twemoji-" + name, "cartoon", [512]);
add("original-anime", "cartoon", [128, 512]);
add("original-anime-side", "cartoon", [512]);
for (const name of ["camping", "rose", "teddy", "bicycle"])
  add("twemoji-" + name, "complex-flat", [512]);
add("twemoji-rocket", "complex-flat", [1024]);
add("original-garden", "complex-flat", [512]);
for (const name of ["signage", "small-symbols"])
  add("original-" + name, "typography", [128, 512]);
add("original-anime", "challenging", [128], {
  variant: "jpeg",
  format: "jpeg",
});
add("original-anime", "challenging", [512], {
  variant: "webp",
  format: "webp",
});
add("original-anime", "challenging", [512], {
  variant: "partial",
  transparent: true,
});
add("original-garden", "challenging", [512], { variant: "low-contrast" });
add("twemoji-fox", "challenging", [128], { variant: "jpeg", format: "jpeg" });
add("original-garden", "challenging", [512], {
  variant: "noise",
  rasterOnly: true,
});
const holdout = new Set([
  "original-compass",
  "twemoji-unicorn",
  "twemoji-bicycle",
  "original-small-symbols",
  "original-garden",
]);
const codes = {
  cat: "1f431",
  fox: "1f98a",
  woman: "1f469",
  unicorn: "1f984",
  camping: "1f3d5",
  rose: "1f339",
  teddy: "1f9f8",
  rocket: "1f680",
  bicycle: "1f6b2",
  palette: "1f3a8",
};
const roi = {
  "original-anime": [
    ["eyes", [26, 53, 73, 24]],
    ["mouth", [50, 83, 29, 16]],
    ["hair-tips", [20, 30, 90, 32]],
  ],
  "original-anime-side": [
    ["eyes", [26, 53, 73, 24]],
    ["hair-ribbon", [79, 12, 38, 25]],
  ],
  "original-signage": [["letter-holes", [7, 15, 108, 100]]],
  "original-small-symbols": [["thin-glyphs", [5, 8, 117, 113]]],
  "twemoji-cat": [["eyes-and-nose", [23, 34, 82, 63]]],
  "twemoji-woman": [["face", [29, 40, 70, 63]]],
  "twemoji-unicorn": [["horn", [24, 0, 36, 51]]],
  "twemoji-bicycle": [["wheels-and-spokes", [1, 35, 126, 92]]],
  "original-garden": [["leaf-gaps", [10, 32, 108, 69]]],
};
for (const row of rows) {
  const reference = `references/${row.family}.svg`,
    bytes = await readFile(root + "/" + reference);
  let svg = bytes.toString();
  if (row.variant === "low-contrast")
    svg = svg.replace(
      /#[0-9a-f]{6}/gi,
      (s) =>
        "#" +
        [1, 3, 5]
          .map((i) =>
            Math.round(255 * 0.82 + parseInt(s.slice(i, i + 2), 16) * 0.18)
              .toString(16)
              .padStart(2, "0"),
          )
          .join(""),
    );
  if (row.variant === "partial")
    svg = svg
      .replace(/(<svg[^>]*>)/, '$1<g opacity="0.68">')
      .replace("</svg>", "</g></svg>");
  // Each size is rendered from its vector; no low-resolution PNG is resized upward.
  const resized = svg.replace(
    "<svg ",
    `<svg width="${row.size * 4}" height="${row.size * 4}" `,
  );
  let pipeline = sharp(Buffer.from(resized)).resize(row.size, row.size, {
    kernel: "lanczos3",
  });
  if (!row.transparent) pipeline = pipeline.flatten({ background: "#ffffff" });
  let rgba = await pipeline.ensureAlpha().raw().toBuffer();
  if (row.variant === "noise") {
    let seed = 17001;
    for (let i = 0; i < rgba.length; i += 4)
      for (let c = 0; c < 3; c++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        rgba[i + c] = Math.max(0, Math.min(255, rgba[i + c] + (seed % 9) - 4));
      }
  }
  const format = row.format ?? "png";
  let encoded = sharp(rgba, {
    raw: { width: row.size, height: row.size, channels: 4 },
  });
  encoded =
    format === "jpeg"
      ? encoded.jpeg({ quality: 38, chromaSubsampling: "4:2:0" })
      : format === "webp"
        ? encoded.webp({ quality: 45 })
        : encoded.png();
  const output = await encoded.toBuffer();
  const image = `images/${row.id}.${format === "jpeg" ? "jpg" : format}`;
  await writeFile(root + "/" + image, output);
  const thirdParty = row.family.startsWith("twemoji-");
  const rawRef = row.rasterOnly ? null : reference;
  Object.assign(row, {
    image,
    width: row.size,
    height: row.size,
    split: holdout.has(row.family) ? "holdout" : "development",
    splitGroup:
      row.family === "original-anime-side" ? "original-anime" : row.family,
    reference: rawRef,
    sourceReference: reference,
    referenceStatus: row.rasterOnly
      ? "reference-withheld-after-raster-degradation"
      : "known-vector-with-declared-rendering-transform",
    license: thirdParty ? "CC-BY-4.0" : "CC0-1.0",
    attribution: thirdParty
      ? "Twemoji graphics, Copyright 2019 Twitter, Inc and other contributors. Rasterization/compression variants by NEXORA; CC-BY 4.0."
      : "Original NEXORA benchmark artwork, dedicated to CC0-1.0.",
    sourceURL: thirdParty
      ? `https://github.com/twitter/twemoji/blob/7a3dad4a4da30497093dab22eafba135f02308e1/assets/svg/${codes[row.family.slice(8)]}.svg`
      : "scripts/real-artwork-fixtures.mjs",
    imageSHA256: hash(output),
    referenceSHA256: hash(bytes),
    mime: `image/${format}`,
    preset: "illustration",
    background: row.transparent ? null : [255, 255, 255],
    rasterization:
      "independent 4x vector raster via libvips/librsvg, Lanczos3 downsample in encoded channels; not linear-light or native area ground truth",
    changes: [
      row.transparent
        ? "group opacity 0.68 on transparent background"
        : "composited on white",
      ...(row.variant ? [row.variant] : []),
    ],
    rois: (roi[row.family] ?? []).map(([label, box]) => ({
      label,
      box: box.map((v) => Math.round((v * row.size) / 128)),
    })),
    cornerReference:
      row.family === "original-compass"
        ? cp.map((p) => p.map((v) => (v * row.size) / 128))
        : null,
  });
  delete row.size;
}
const citySource = await readFile(root + "/raster-originals/kenney-city.png");
const city = await sharp(citySource).resize({ width: 512 }).png().toBuffer();
const cityMeta = await sharp(city).metadata();
await writeFile(root + "/images/kenney-city-512.png", city);
rows.push({
  id: "kenney-city-512",
  family: "kenney-city",
  splitGroup: "kenney-city",
  category: "challenging",
  image: "images/kenney-city-512.png",
  width: cityMeta.width,
  height: cityMeta.height,
  split: "holdout",
  reference: null,
  sourceReference: null,
  referenceStatus: "natural-raster-only-no-vector-reference",
  license: "MIT",
  attribution:
    "Copyright (c) 2025 Kenney. Screenshot is associated documentation of Starter Kit City Builder; repository license retained. README identifies sprites/models as CC0.",
  sourceURL:
    "https://github.com/KenneyNL/Starter-Kit-City-Builder/blob/4535092b740b378b700efd9df9e27a631815b84a/screenshots/screenshot.png",
  sourceImage: "raster-originals/kenney-city.png",
  sourceSHA256: hash(citySource),
  imageSHA256: hash(city),
  mime: "image/png",
  preset: "illustration",
  background: null,
  maskApplicable: false,
  rasterization:
    "Downsized original raster, not independently vector-rasterized. No geometric ground truth.",
  changes: ["aspect-preserving downsizing to 512px width"],
  rois: [],
  cornerReference: null,
});
await writeFile(
  root + "/manifest.json",
  JSON.stringify(
    {
      schema: 2,
      previousManifestSHA256:
        "edfa9efa7dfb940fe1171177980e8e7974b2b091561925a0b396fbb47dc320b5",
      splitCorrection:
        "Portrait siblings share one template. Both are development; v1 assignment retained in manifest.v1.json. No raster/reference or engine threshold changed.",
      baseline: "ce63c7202f2f0836b2123036b8e24db939ffa420",
      policy:
        "Evaluation only. Holdout split by independent design group; initial pre-trace split and later template-leakage correction are retained. Never tune engine or anomaly thresholds from holdout. PNG sizes independently rasterized; codecs/noise explicitly derived. References never supplied to engine.",
      external: {
        name: "Twemoji 14.0.2",
        commit: "7a3dad4a4da30497093dab22eafba135f02308e1",
        tag: "v14.0.2",
        license: "CC-BY-4.0",
        licenseFile: "licenses/TWEMOJI-CC-BY-4.0.txt",
      },
      images: rows,
    },
    null,
    2,
  ),
);
console.log({
  images: rows.length,
  families: new Set(rows.map((r) => r.family)).size,
  holdout: rows.filter((r) => r.split === "holdout").length,
});
