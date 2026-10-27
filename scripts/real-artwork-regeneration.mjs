// Byte-for-byte reproducibility check in an isolated cwd, not the committed corpus.
import { cp, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
const root = resolve(process.env.NEXORA_ART_REGEN_ROOT),
  original = resolve("tests/fixtures/real-artwork");
await mkdir(root);
await mkdir(root + "/tests/fixtures", { recursive: true });
await cp(original, root + "/tests/fixtures/real-artwork", { recursive: true });
const { stdout, stderr } = await promisify(execFile)(
  process.execPath,
  [resolve("scripts/real-artwork-fixtures.mjs")],
  { cwd: root, timeout: 30000 },
);
await writeFile(root + "/generation.log", stdout + stderr);
const hash = (b) => createHash("sha256").update(b).digest("hex");
const changes = [];
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = resolve(dir, e.name);
    if (e.isDirectory()) await walk(p);
    else {
      const rel = relative(original, p),
        a = hash(await readFile(p)),
        b = hash(await readFile(root + "/tests/fixtures/real-artwork/" + rel));
      if (a !== b) changes.push({ file: rel, original: a, regenerated: b });
    }
  }
}
await walk(original);
await writeFile(
  root + "/result.json",
  JSON.stringify(
    {
      status: changes.length ? "FAIL" : "PASS",
      changes,
      policy:
        "All reference/raster/manifest/license bytes compared; no committed input overwritten.",
    },
    null,
    2,
  ),
);
console.log({ changes: changes.length });
if (changes.length) process.exitCode = 1;
