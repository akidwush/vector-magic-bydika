// Original, source-only CC0 designs. Development and unseen families fixed before experiments.
import { mkdir, writeFile, readFile } from "node:fs/promises";
import sharp from "sharp";
import { createHash } from "node:crypto";
const root =
  process.env.NEXORA_THIN_REGEN_ROOT ?? "tests/fixtures/thin-feature";
await mkdir(root + "/references", { recursive: true });
await mkdir(root + "/images", { recursive: true });
const sha = (b) => createHash("sha256").update(b).digest("hex");
const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">${body}</svg>`;
const designs = {
  "circuit-ribbon": {
    split: "development",
    svg: svg(
      '<rect width="128" height="128" fill="#fff"/><rect x="12" y="12" width="104" height="35" rx="6" fill="#244a68"/><path d="M28 22h10v15H28zM55 21h3v18h-3zM76 22h10v15H76zM101 21h2v18h-2z" fill="#fff"/><path d="M12 75C27 48 48 98 66 75S99 51 116 75M13 103h31l15-14 19 23h35" fill="none" stroke="#244a68" stroke-width="1.15"/><g fill="#bb6248"><circle cx="14" cy="75" r="2.5"/><circle cx="114" cy="75" r="2.5"/><circle cx="43" cy="103" r="1.5"/></g>',
    ),
  },
  "stencil-kite": {
    split: "holdout",
    svg: svg(
      '<rect width="128" height="128" fill="#fff"/><path d="M14 18h30v39H14zM53 18h25v39H53zM87 18h26v39H87z" fill="#393e62"/><path d="M23 26h12v22H23zM63 26h5v22h-5zM97 26h6v22h-6z" fill="#fff"/><path d="M14 104L34 75 51 102 72 72 92 99 113 70M20 117C42 100 75 127 108 111" fill="none" stroke="#393e62" stroke-width="1.25"/><path d="M91 78l7 7-7 7-7-7z" fill="#bd7a38"/>',
    ),
  },
  "ribbon-garden": {
    split: "holdout",
    svg: svg(
      '<rect width="128" height="128" fill="#f7f5ed"/><g fill="#39736b"><path d="M12 22h28v35H12zM49 22h28v35H49zM86 22h28v35H86z"/><path d="M15 98C40 64 56 119 81 91S107 68 115 87" fill="none" stroke="#39736b" stroke-width="1.2"/></g><path d="M24 29h3v21h-3zM60 29h5v21h-5zM98 29h2v21h-2z" fill="#f7f5ed"/><g fill="#c87551"><circle cx="15" cy="98" r="2"/><circle cx="81" cy="91" r="2"/><circle cx="115" cy="87" r="2"/></g>',
    ),
  },
};
// Added only after rejecting the full ridge model. No candidate outcomes were
// inspected on this independent design before the negative-only rules were frozen.
designs["orbital-badge"] = {
  split: "holdout",
  background: [246, 244, 238],
  validationEpoch: "negative-only-post-selection",
  svg: svg(
    '<rect width="128" height="128" fill="#f6f4ee"/><circle cx="64" cy="64" r="49" fill="#294957"/><circle cx="64" cy="64" r="34" fill="#658991"/><path d="M64 19l6 10-6 5-6-5zM104 62l7 6-9 5zM21 73l10 2-5 8z" fill="#c87950"/><path d="M30 47h27v2H30z" fill="#f6f4ee"/><rect x="71" y="79" width="26" height="2" transform="rotate(-28 84 80)" fill="#f6f4ee"/><path d="M46 91q18 15 36-1" fill="none" stroke="#294957" stroke-width="4"/>',
  ),
};
const images = [];
for (const [family, d] of Object.entries(designs)) {
  const reference = "references/" + family + ".svg";
  await writeFile(root + "/" + reference, d.svg);
  for (const width of [128, 512]) {
    const input = await sharp(Buffer.from(d.svg), {
      density: ((72 * width) / 128) * 4,
    })
      .resize(width * 4, width * 4)
      .png()
      .toBuffer();
    const image = "images/" + family + "-" + width + ".png";
    const b = await sharp(input)
      .resize(width, width, { kernel: "lanczos3" })
      .png()
      .toBuffer();
    await writeFile(root + "/" + image, b);
    images.push({
      id: family + "-" + width,
      family,
      splitGroup: family,
      split: d.split,
      category: "thin-feature-generalization",
      validationEpoch: d.validationEpoch ?? "full-model-frozen",
      width,
      height: width,
      image,
      mime: "image/png",
      imageSHA256: sha(b),
      reference,
      sourceReference: reference,
      referenceSHA256: sha(Buffer.from(d.svg)),
      referenceStatus: "known-original-vector",
      license: "CC0-1.0",
      attribution: "Original NEXORA Stage 1.7B benchmark artwork; CC0-1.0.",
      sourceURL: "scripts/thin-feature-fixtures.mjs",
      preset: "illustration",
      background:
        d.background ??
        (family === "ribbon-garden" ? [247, 245, 237] : [255, 255, 255]),
      maskApplicable: true,
      rois: [],
      cornerReference: null,
      rendering:
        "Independent 4x source rasterization, Lanczos3 downsample; not resized from another fixture.",
    });
  }
}
await writeFile(
  root + "/manifest.json",
  JSON.stringify(
    {
      schema: 2,
      base: "ca3871e14ca633aad09503e78681631348d71b75",
      policy:
        "Original split labels retained. Full mode 3 was frozen before stencil/ribbon validation. Negative-only mode 4 was selected after source-RGB rejection of full-mode ridges; only orbital-badge is untouched post-selection validation for mode 4. No reference reaches either solver.",
      images,
    },
    null,
    2,
  ),
);
console.log({ images: images.length });
