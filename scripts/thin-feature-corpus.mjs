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
    "Existing Stage 1.7A split unchanged; new circuit-ribbon is development. Existing symbols/garden and new stencil/ribbon families remain validation-only. Reference SVGs are evaluator inputs only.",
};
await writeFile(root + "/manifest.json", JSON.stringify(m, null, 2));
console.log({ images: m.images.length });
