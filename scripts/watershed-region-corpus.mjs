import { mkdir, cp, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = process.env.NEXORA_WATERSHED_CORPUS;
await mkdir(root);
const sources = [
  "tests/fixtures/real-artwork",
  "tests/fixtures/thin-feature",
  "tests/fixtures/watershed-region",
];
let images = [];
const manifests = [];
for (const s of sources) {
  for (const dir of ["images", "references"])
    await cp(s + "/" + dir, root + "/" + dir, { recursive: true });
  const b = await readFile(s + "/manifest.json");
  manifests.push({
    path: s + "/manifest.json",
    sha256: createHash("sha256").update(b).digest("hex"),
  });
  images.push(...JSON.parse(b).images);
}
const first = JSON.parse(await readFile(sources[0] + "/manifest.json"));
await writeFile(
  root + "/manifest.json",
  JSON.stringify(
    {
      ...first,
      schema: 4,
      baseline: "ad770ad49b6168a75c1751bfbed412aad824fc15",
      sourceManifests: manifests,
      images,
      policy:
        "Old A/B splits are provenance, not new blind claims. Stage C botanical development; harbour final assessment only. Sources and legal references unchanged. Converter receives raster only.",
    },
    null,
    2,
  ),
);
