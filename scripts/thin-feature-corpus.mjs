// Join immutable artwork with new, explicitly split designs without changing either source manifest.
import { readFile, writeFile, mkdir, cp } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const root = resolve(process.env.NEXORA_THIN_CORPUS);
await mkdir(root);
const a = "tests/fixtures/real-artwork",
  b = "tests/fixtures/thin-feature";
await cp(a, root, { recursive: true });
await cp(b + "/README.md", root + "/THIN_FEATURE_RIGHTS.md");
const one = JSON.parse(await readFile(a + "/manifest.json")),
  two = JSON.parse(await readFile(b + "/manifest.json"));
for (const name of ["references", "images"])
  await cp(b + "/" + name, root + "/" + name, { recursive: true });
const m = {
  ...one,
  schema: 3,
  sourceManifests: [a + "/manifest.json", b + "/manifest.json"],
  sourceManifestSHA256: await Promise.all(
    [a, b].map(async (p) =>
      createHash("sha256")
        .update(await readFile(p + "/manifest.json"))
        .digest("hex"),
    ),
  ),
  images: [...one.images, ...two.images],
  policy:
    "Original split labels retained as provenance. Mode 3 full-model validation predates negative-only model selection. Orbital-badge is the untouched post-selection mode-4 family; old holdout results are not claimed as unseen for the selected subset. References are offline only.",
};
await writeFile(root + "/manifest.json", JSON.stringify(m, null, 2));
console.log({ images: m.images.length });
