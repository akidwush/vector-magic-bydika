import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";
const root = "tests/fixtures/stage12";
for (const size of [128, 512]) {
  const png = await readFile(`tests/fixtures/quality/cat-${size}-opaque.png`);
  await sharp(png).blur(0.7).png().toFile(`${root}/cat-${size}-blended.png`);
  await sharp(png)
    .jpeg({ quality: 60 })
    .toFile(`${root}/cat-${size}-lossy.jpg`);
  await sharp(png)
    .webp({ quality: 60 })
    .toFile(`${root}/cat-${size}-lossy.webp`);
  await sharp(`${root}/openmoji-cat.svg`)
    .resize(size, size)
    .png()
    .toFile(`${root}/openmoji-cat-${size}.png`);
}
await writeFile(
  `${root}/README.md`,
  `# Stage 1.2 fixture provenance\n\nCat fixtures: original project CC0 vector ground truth from scripts/quality-fixtures.mjs, encoded/blended deterministically by scripts/stage12-fixtures.mjs. Blur is a test input only, not production preprocessing.\n\nOpenMoji cat face (1F431): OpenMoji contributors, CC BY-SA 4.0, https://openmoji.org/ and https://github.com/hfg-gmuend/openmoji/blob/aeb8bb3a59e2de39c754ac79180c8131c906acea/color/svg/1F431.svg . Exact source retained; resized PNG derivatives retain CC BY-SA 4.0. No design changes. Full license: OPENMOJI-LICENSE.txt. Attribution must accompany redistribution. Does not change application license.\n`,
);
