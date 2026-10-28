// Supplementary mechanism stress family, NOT blind real-artwork generalization.
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";
const root =
  process.env.NEXORA_WATERSHED_TIES ?? "tests/fixtures/watershed-region-ties";
await mkdir(root + "/references", { recursive: true });
await mkdir(root + "/images", { recursive: true });
let body =
  '<rect width="128" height="128" fill="#fcfcfc"/><rect x="10" y="9" width="104" height="9" rx="2" fill="#e0e6e4"/>';
for (let y = 0; y < 4; y++)
  for (let x = 0; x < 6; x++)
    body += `<rect x="${10 + x * 18}" y="${29 + y * 22}" width="14" height="15" fill="#f0f0f0"/>`;
const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">' +
    body +
    "</svg>",
  ref = "references/pale-planner.svg",
  sha = (b) => createHash("sha256").update(b).digest("hex");
await writeFile(root + "/" + ref, svg);
const images = [];
for (const variant of ["rounded", "square"]) {
  const drawing = variant === "square" ? svg.replace(' rx="2"', "") : svg;
  const family = variant === "square" ? "pale-planner-square" : "pale-planner";
  const reference = "references/" + family + ".svg";
  await writeFile(root + "/" + reference, drawing);
  for (const width of [128, 512]) {
    const hi = await sharp(Buffer.from(drawing), {
        density: ((72 * width) / 128) * 4,
      })
        .resize(width * 4, width * 4)
        .png()
        .toBuffer(),
      png = await sharp(hi)
        .resize(width, width, { kernel: "lanczos3" })
        .png()
        .toBuffer(),
      image = "images/" + family + "-" + width + ".png";
    await writeFile(root + "/" + image, png);
    images.push({
      id: family + "-" + width,
      family,
      splitGroup: "pale-planner",
      split: "development",
      category: "watershed-mechanism-stress",
      validationEpoch: "post-7169751-predicted-MST-tie",
      width,
      height: width,
      image,
      mime: "image/png",
      imageSHA256: sha(png),
      reference,
      sourceReference: reference,
      referenceSHA256: sha(Buffer.from(drawing)),
      referenceStatus: "known-original-vector",
      license: "CC0-1.0",
      attribution: "Original Stage 1.7C calendar/grid stress artwork; CC0-1.0.",
      sourceURL: "scripts/watershed-region-tie-fixtures.mjs",
      preset: "illustration",
      background: [252, 252, 252],
      maskApplicable: true,
      rois: [],
      cornerReference: null,
      rendering: "Independent4x SVG rasterization and Lanczos3.",
    });
  }
}
await writeFile(
  root + "/manifest.json",
  JSON.stringify(
    {
      schema: 3,
      baseline: "ad770ad49b6168a75c1751bfbed412aad824fc15",
      policy:
        "Designed after model freeze to challenge equal-persistence merges at fixed detail96. Development mechanism stress, not untouched artistic holdout. No threshold changes from this experiment are implied.",
      images,
    },
    null,
    2,
  ),
);
