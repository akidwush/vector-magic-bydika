import { chromium } from "@playwright/test";
import sharp from "sharp";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { metrics, stats } from "./quality-metrics.mjs";
const out = "benchmark-results/quality";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.NEXORA_CHROMIUM_PATH || "/usr/bin/chromium",
});
const page = await browser.newPage();
await page.goto(
  `http://127.0.0.1:${process.env.NEXORA_RESEARCH_PORT || 4183}/nexora/`,
);
await page.addScriptTag({ url: "/research/imagetracer.js" });
const candidates = [
  ["baseline", 7, 2, 16, 24, "spline", false, false, 60, 4],
  ["cutout", 7, 2, 16, 24, "spline", true, false, 60, 4],
  ["watershed", 7, 2, 16, 24, "spline", true, true, 60, 4],
  ["poster", 8, 4, 16, 0, "spline", false, false, 60, 4],
  ...[5, 6, 8].map((p) => [
    "precision" + p,
    p,
    2,
    16,
    24,
    "spline",
    false,
    false,
    60,
    4,
  ]),
  ...[3, 4, 6].map((s) => [
    "speckle" + s,
    7,
    s,
    16,
    24,
    "spline",
    false,
    false,
    60,
    4,
  ]),
  ...[12, 24, 32].map((l) => [
    "layer" + l,
    7,
    2,
    l,
    24,
    "spline",
    false,
    false,
    60,
    4,
  ]),
  ...[0, 6, 8, 12].map((c) => [
    "palette" + c,
    7,
    2,
    16,
    c,
    "spline",
    false,
    false,
    60,
    4,
  ]),
  ["polygon", 7, 2, 16, 24, "polygon", false, false, 60, 4],
  ["corners", 7, 2, 16, 24, "spline", false, false, 45, 2],
  ["combined", 6, 3, 24, 12, "spline", true, false, 60, 4],
  ["fallback"],
];
const names = process.argv.includes("--full")
  ? [
      ...["128", "512", "1024"].flatMap((n) =>
        ["opaque", "binary", "partial"].map((a) => `quality/cat-${n}-${a}.png`),
      ),
      ...[
        "icon.png",
        "corners.png",
        "curves.png",
        "illustration.png",
        "lineart.png",
        "gradient.jpg",
        "transparent.png",
        "illustration.webp",
      ],
    ]
  : [
      "quality/cat-128-opaque.png",
      "quality/cat-128-partial.png",
      "illustration.webp",
      "lineart.png",
    ];
const results = process.argv.includes("--resume")
  ? JSON.parse(await readFile(`${out}/progress.json`, "utf8"))
  : [];
for (const name of names) {
  if (results.some((r) => r.name === name)) continue;
  const encoded = await readFile("tests/fixtures/" + name);
  const inputs = [["original", encoded]];
  if (name.startsWith("quality/")) {
    inputs.push([
      "webp",
      await sharp(encoded).webp({ quality: 65 }).toBuffer(),
    ]);
    if (name.includes("opaque"))
      inputs.push([
        "jpeg",
        await sharp(encoded).jpeg({ quality: 70 }).toBuffer(),
      ]);
  }
  for (const [format, buffer] of inputs) {
    const input = await page.evaluate(async (base64) => {
      const blob = await (
        await fetch("data:application/octet-stream;base64," + base64)
      ).blob();
      const img = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      return {
        width: img.width,
        height: img.height,
        rgba: btoa(
          Array.from(ctx.getImageData(0, 0, img.width, img.height).data)
            .map((x) => String.fromCharCode(x))
            .join(""),
        ),
      };
    }, buffer.toString("base64"));
    const bins = new Uint32Array(4096);
    const rgba = Buffer.from(input.rgba, "base64");
    for (let i = 0; i < rgba.length; i += 4)
      bins[
        ((rgba[i] >> 4) << 8) | ((rgba[i + 1] >> 4) << 4) | (rgba[i + 2] >> 4)
      ]++;
    bins.sort();
    const flat =
      bins.slice(-8).reduce((a, b) => a + b, 0) * 100 >= (rgba.length / 4) * 85;
    const selected = [...candidates[0]];
    selected[0] = "selected";
    selected[1] = flat ? 5 : 7;
    const configs = process.argv.includes("--full")
      ? [candidates[0], selected]
      : candidates;
    for (const config of configs) {
      try {
        const result = await page.evaluate(
          async ({ input, config }) => {
            input.rgba = Uint8Array.from(atob(input.rgba), (c) =>
              c.charCodeAt(0),
            );
            const m = await import("/research/nexora_wasm.js");
            await m.default();
            const start = performance.now();
            let svg;
            if (config[0] === "fallback") {
              svg = window.ImageTracer.imagedataToSVG(
                {
                  data: new Uint8ClampedArray(input.rgba),
                  width: input.width,
                  height: input.height,
                },
                {
                  numberofcolors: 24,
                  colorsampling: 2,
                  ltres: 0.5,
                  qtres: 1,
                  pathomit: 4,
                  roundcoords: 2,
                  strokewidth: 1,
                  desc: false,
                },
              );
            } else
              svg = m.experiment(
                new Uint8Array(input.rgba),
                input.width,
                input.height,
                ...config.slice(1),
              );
            return { svg, ms: performance.now() - start };
          },
          { input, config },
        );
        const raw = await sharp(Buffer.from(result.svg))
          .ensureAlpha()
          .raw()
          .toBuffer();
        const rendered = await page.evaluate(async (svg) => {
          const url = URL.createObjectURL(
            new Blob([svg], { type: "image/svg+xml" }),
          );
          const b = new Image();
          b.src = url;
          await b.decode();
          URL.revokeObjectURL(url);
          const c = document.createElement("canvas");
          c.width = b.width;
          c.height = b.height;
          const ctx = c.getContext("2d");
          ctx.drawImage(b, 0, 0);
          return btoa(
            Array.from(ctx.getImageData(0, 0, b.width, b.height).data)
              .map((x) => String.fromCharCode(x))
              .join(""),
          );
        }, result.svg);
        const opaque =
          !name.includes("partial") &&
          !name.includes("binary") &&
          !name.includes("transparent");
        const m = metrics(
          Buffer.from(input.rgba, "base64"),
          raw,
          input.width,
          input.height,
          opaque,
        );
        const bm = metrics(
          Buffer.from(input.rgba, "base64"),
          Buffer.from(rendered, "base64"),
          input.width,
          input.height,
          opaque,
        );
        const id = name.replaceAll("/", "-") + "-" + format + "-" + config[0];
        await writeFile(`${out}/${id}.svg`, result.svg);
        if (process.argv.includes("--full")) {
          await sharp(Buffer.from(result.svg)).png().toFile(`${out}/${id}.png`);
          const src = await sharp(buffer).ensureAlpha().png().toBuffer();
          await sharp({
            create: {
              width: input.width * 2,
              height: input.height,
              channels: 4,
              background: "#bbbbbb",
            },
          })
            .composite([
              { input: src, left: 0, top: 0 },
              {
                input: await sharp(Buffer.from(result.svg)).png().toBuffer(),
                left: input.width,
                top: 0,
              },
            ])
            .png()
            .toFile(`${out}/${id}-ab.png`);
        }
        results.push({
          name,
          format,
          candidate: config[0],
          config: config.slice(1),
          width: input.width,
          height: input.height,
          stats: stats(Buffer.from(input.rgba, "base64")),
          ...m,
          browserMAE: bm.mae,
          browserIoU: bm.iou,
          paths: (result.svg.match(/<path/g) || []).length,
          bytes: Buffer.byteLength(result.svg),
          ms: result.ms,
        });
      } catch (e) {
        console.log(config[0], String(e).slice(0, 300));
        results.push({ name, format, candidate: config[0], error: String(e) });
      }
    }
  }
  console.log(name, "done");
  await writeFile(`${out}/progress.json`, JSON.stringify(results, null, 2));
}
await writeFile(
  `${out}/${process.argv.includes("--full") ? "full" : "matrix"}.json`,
  JSON.stringify({ browser: browser.version(), results }, null, 2),
);
await browser.close();
