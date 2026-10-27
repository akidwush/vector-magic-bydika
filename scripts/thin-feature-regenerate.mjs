import { mkdir, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const root = process.env.NEXORA_THIN_REGEN_ROOT;
if (!root) throw Error("Fresh output required");
await mkdir(root);
execFileSync(process.execPath, ["scripts/thin-feature-fixtures.mjs"], {
  env: { ...process.env, NEXORA_THIN_REGEN_ROOT: root },
  stdio: "inherit",
});
const sha = (b) => createHash("sha256").update(b).digest("hex");
const manifest = JSON.parse(
  await readFile("tests/fixtures/thin-feature/manifest.json"),
);
for (const r of manifest.images) {
  for (const file of [r.image, r.reference])
    if (
      sha(await readFile(root + "/" + file)) !==
      sha(await readFile("tests/fixtures/thin-feature/" + file))
    )
      throw Error("Regeneration changed " + file);
}
console.log({
  images: manifest.images.length,
  status: "BYTE_IDENTICAL",
  license: "CC0-1.0",
  referencePolicy: "Offline evaluator only",
});
