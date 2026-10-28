// Original CC0 artwork; references are offline-only. No resized cross-resolution inference.
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";
const root =
  process.env.NEXORA_WATERSHED_FIXTURES ?? "tests/fixtures/watershed-region";
await mkdir(root + "/references", { recursive: true });
await mkdir(root + "/images", { recursive: true });
const wrap = (b) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" fill="#fcfcfc"/>${b}</svg>`;
const designs = {
  "paper-botanical": {
    split: "development",
    svg: wrap(
      '<path d="M16 108Q29 79 25 41M53 109Q50 65 62 28M91 109Q104 71 97 35" stroke="#f3faf8" stroke-width="3" fill="none"/><g fill="#f3faf8"><ellipse cx="18" cy="69" rx="9" ry="4" transform="rotate(30 18 69)"/><ellipse cx="36" cy="82" rx="11" ry="4" transform="rotate(-30 36 82)"/><ellipse cx="53" cy="57" rx="10" ry="4"/><ellipse cx="103" cy="78" rx="12" ry="4" transform="rotate(-25 103 78)"/></g><g fill="#faf3f7"><circle cx="25" cy="33" r="10"/><circle cx="65" cy="22" r="11"/><circle cx="96" cy="28" r="10"/></g><g fill="#fcfcfc"><circle cx="25" cy="33" r="3"/><circle cx="65" cy="22" r="3"/><circle cx="96" cy="28" r="3"/></g><path d="M12 112H115v5H12z" fill="#f5f8f3"/>',
    ),
  },
  "paper-harbour": {
    split: "holdout",
    svg: wrap(
      '<path d="M14 78h100l-15 25H29z" fill="#e3eaf1"/><path d="M61 15v61H22z" fill="#eee6dd"/><path d="M67 28v48h38z" fill="#e2eee8"/><path d="M16 109q10-6 20 0t20 0t20 0t20 0t20 0" fill="none" stroke="#e4edf0" stroke-width="2"/><path d="M39 83h3v13h-3zM65 83h3v13h-3zM87 83h3v13h-3z" fill="#fcfcfc"/><circle cx="105" cy="23" r="8" fill="#f1e8e4"/>',
    ),
  },
};
const sha = (b) => createHash("sha256").update(b).digest("hex"),
  images = [];
for (const [family, d] of Object.entries(designs)) {
  const reference = "references/" + family + ".svg";
  await writeFile(root + "/" + reference, d.svg);
  for (const width of [128, 512]) {
    const b = await sharp(Buffer.from(d.svg), {
        density: ((72 * width) / 128) * 4,
      })
        .resize(width * 4, width * 4)
        .png()
        .toBuffer(),
      png = await sharp(b)
        .resize(width, width, { kernel: "lanczos3" })
        .png()
        .toBuffer(),
      image = "images/" + family + "-" + width + ".png";
    await writeFile(root + "/" + image, png);
    images.push({
      id: family + "-" + width,
      family,
      splitGroup: family,
      split: d.split,
      category: "low-contrast-original-artwork",
      validationEpoch: "stage17c-initial",
      width,
      height: width,
      image,
      mime: "image/png",
      imageSHA256: sha(png),
      reference,
      sourceReference: reference,
      referenceSHA256: sha(Buffer.from(d.svg)),
      referenceStatus: "known-original-vector",
      license: "CC0-1.0",
      attribution: "Original NEXORA Stage 1.7C artwork, dedicated to CC0-1.0.",
      sourceURL: "scripts/watershed-region-fixtures.mjs",
      preset: "illustration",
      background: [252, 252, 252],
      maskApplicable: true,
      rois: [],
      cornerReference: null,
      rendering: "Independent 4x rasterization plus Lanczos3.",
    });
  }
}
await writeFile(
  root + "/manifest.json",
  JSON.stringify(
    {
      schema: 3,
      base: "ad770ad49b6168a75c1751bfbed412aad824fc15",
      policy:
        "Botanical development; harbour unseen until predicate freeze. Prior A/B holdouts are previously observed assessment, not untouched tuning sets.",
      images,
    },
    null,
    2,
  ),
);
