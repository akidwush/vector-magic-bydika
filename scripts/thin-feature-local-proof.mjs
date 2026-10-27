// Offline proof for every source-certified region, using unchanged actual downloads.
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
const root = process.env.NEXORA_THIN_EVALUATION,
  diagnosis = process.env.NEXORA_THIN_LOCAL_DIAG_ROOT,
  fixtures = process.env.NEXORA_ART_FIXTURES ?? "tests/fixtures/real-artwork";
if (!root || !diagnosis)
  throw Error("Completed exports and diagnostic capture required");
const out = diagnosis + "/exported-local-proof";
await mkdir(out);
const rows = (await readFile(root + "/analysis/measurements.jsonl", "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse),
  manifest = JSON.parse(await readFile(fixtures + "/manifest.json")),
  sha = (b) => createHash("sha256").update(b).digest("hex"),
  browser = await chromium.launch({
    executablePath: process.env.NEXORA_CHROMIUM_PATH,
  }),
  page = await browser.newPage(),
  results = [];
try {
  for (const file of (await readdir(diagnosis + "/exports")).filter((f) =>
    f.endsWith("-diagnostic.json"),
  )) {
    const id = file.replace("-diagnostic.json", ""),
      diag = JSON.parse(await readFile(diagnosis + "/exports/" + file)),
      item = manifest.images.find((r) => r.id === id),
      source = await sharp(fixtures + "/" + item.image)
        .ensureAlpha()
        .raw()
        .toBuffer();
    const candidates = diag.events.filter((e) => e.kind === "protection");
    if (!candidates.length) continue;
    const pair = [];
    for (const config of [
      "A-auto",
      process.env.NEXORA_THIN_CANDIDATE_ID ?? "thin-structural",
    ]) {
      const row = rows.find((r) => r.image === id && r.config.id === config),
        svg = await readFile(root + "/" + row.export, "utf8");
      if (sha(Buffer.from(svg)) !== row.svgSHA256)
        throw Error("Downloaded SVG changed");
      const vips = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer(),
        chrome = await sharp(root + "/analysis/" + row.id + "-chromium.png")
          .ensureAlpha()
          .raw()
          .toBuffer();
      const local = [];
      for (const e of candidates) {
        const [x, y, w, h] = e.box,
          box = [
            Math.max(0, x - 2),
            Math.max(0, y - 2),
            Math.min(item.width, x + w + 2),
            Math.min(item.height, y + h + 2),
          ];
        function loss(render, rect) {
          let s = 0,
            n = 0;
          for (let yy = rect[1]; yy < rect[3]; yy++)
            for (let xx = rect[0]; xx < rect[2]; xx++) {
              const i = (yy * item.width + xx) * 4;
              for (let c = 0; c < 4; c++)
                s += Math.abs(
                  c === 3
                    ? source[i + c] - render[i + c]
                    : (source[i + c] * source[i + 3] -
                        render[i + c] * render[i + 3]) /
                        255,
                );
              n += 4;
            }
          return s / n;
        }
        const pathOwners = await page.evaluate(
          ({ svg, box }) => {
            document.body.innerHTML = svg;
            const root = document.querySelector("svg");
            if (
              root.querySelector(
                "mask,clipPath,filter,[opacity],[fill-opacity]",
              )
            )
              return {
                status: "UNSUPPORTED",
                reason: "Compositing/mask requires rendered ownership",
              };
            const paths = [...root.querySelectorAll("path")],
              counts = new Map();
            for (let y = box[1]; y < box[1] + box[3]; y++)
              for (let x = box[0]; x < box[0] + box[2]; x++) {
                let owner = -1;
                for (let i = 0; i < paths.length; i++) {
                  const p = paths[i],
                    m = p.getCTM();
                  if (
                    m &&
                    p.isPointInFill(
                      new DOMPoint(x + 0.5, y + 0.5)
                        .matrixTransform(root.getCTM())
                        .matrixTransform(m.inverse()),
                    )
                  )
                    owner = i;
                }
                counts.set(owner, (counts.get(owner) || 0) + 1);
              }
            return {
              status: "MEASURED",
              paintedPixelCenterOwners: [...counts].map(([path, pixels]) => ({
                path,
                pixels,
                fill: path < 0 ? null : paths[path].getAttribute("fill"),
              })),
              scope:
                "Topmost fill ownership at pixel centers; exact area antialiasing remains independently rasterized.",
            };
          },
          { svg, box: e.box },
        );
        local.push({
          ...e,
          patch: {
            libvipsMae: loss(vips, [x, y, x + w, y + h]),
            chromiumMae: loss(chrome, [x, y, x + w, y + h]),
          },
          contextBox: box,
          context: {
            libvipsMae: loss(vips, box),
            chromiumMae: loss(chrome, box),
          },
          pathOwners,
        });
      }
      pair.push({ config, svgSHA256: row.svgSHA256, regions: local });
    }
    results.push({ image: id, variants: pair });
  }
} finally {
  await browser.close();
}
await writeFile(out + "/regions.json", JSON.stringify(results, null, 2));
const failures = [];
for (const image of results) {
  for (let i = 0; i < image.variants[0].regions.length; i++) {
    const b = image.variants[0].regions[i],
      c = image.variants[1].regions[i];
    for (const scope of ["patch", "context"])
      for (const renderer of ["libvipsMae", "chromiumMae"])
        if (c[scope][renderer] > b[scope][renderer] + 1e-9)
          failures.push({
            image: image.image,
            box: c.box,
            scope,
            renderer,
            before: b[scope][renderer],
            after: c[scope][renderer],
          });
  }
}
await writeFile(
  out + "/local-verdict.json",
  JSON.stringify(
    {
      status: failures.length ? "REJECT_CANDIDATE" : "LOCAL_NONREGRESSION",
      failures,
      policy:
        "Strict local source reconstruction; no historical gate changed. Measurement-only mode preserves the rejected full-model evidence.",
    },
    null,
    2,
  ),
);
if (failures.length && process.env.NEXORA_THIN_LOCAL_STRICT === "1")
  process.exitCode = 1;

console.log(
  results.map((r) => ({
    image: r.image,
    regions: r.variants[0].regions.length,
    negativeRegions: r.variants[0].regions.filter((e) => e.backgroundPaint)
      .length,
  })),
);
