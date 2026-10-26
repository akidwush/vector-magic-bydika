import { spawnSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import sharp from "sharp";
import { geometry } from "./curve-geometry-metrics.mjs";
import { metrics } from "./quality-metrics.mjs";
const root = resolve(
  process.env.NEXORA_PROOF_DIR || "benchmark-results/stage16c/browser-proof",
);
const dir = root + "/low-resolution/inkscape";
await mkdir(dir, { recursive: true });
const env = { ...process.env, INKSCAPE_PROFILE_DIR: dir + "/profile" };
const version = spawnSync("inkscape", ["--version"], { env, encoding: "utf8" });
if (version.error?.code === "ENOENT") {
  await writeFile(
    dir + "/results.json",
    JSON.stringify({ status: "unverified", reason: "Inkscape unavailable" }),
  );
  console.log(
    "Inkscape unavailable; low-resolution import remains unverified here.",
  );
} else {
  assert.equal(version.status, 0, version.stderr);
  const rows = JSON.parse(
    await readFile(root + "/low-resolution/comparison.json"),
  );
  const results = [];
  for (const row of rows.filter(
    (r) =>
      r.core &&
      ((r.name === "cubic" && r.width < 1024) ||
        (r.name === "wave" && r.width === 128)),
  )) {
    const c = row.variants[1],
      input = root + "/low-resolution/exports/" + c.filename,
      plain = dir + "/" + row.key + ".svg",
      png = plain + ".png";
    for (const args of [
      [input, "--export-plain-svg", "--export-filename=" + plain],
      [plain, "--export-type=png", "--export-filename=" + png],
    ]) {
      const r = spawnSync("inkscape", args, {
        env,
        encoding: "utf8",
        timeout: 60000,
      });
      assert.equal(r.status, 0, r.stderr);
    }
    const svg = await readFile(plain, "utf8"),
      g = geometry(svg);
    assert(!/<image\b/.test(svg));
    assert.equal(g.anchors, c.anchors);
    assert.equal(g.closed, c.structure.closed);
    const source = await sharp(row.input).ensureAlpha().raw().toBuffer();
    const output = await sharp(png).ensureAlpha().raw().toBuffer();
    const quality = metrics(source, output, row.width, row.height, true);
    assert(
      quality.mae <= c.raster.mae + 0.3,
      "Inkscape roundtrip reconstruction drift",
    );
    results.push({
      key: row.key,
      anchors: g.anchors,
      paths: g.paths.length,
      quality,
    });
  }
  await writeFile(
    dir + "/results.json",
    JSON.stringify(
      {
        version: version.stdout.trim(),
        status:
          "CLI import/plain SVG roundtrip and PNG export verified; GUI/Illustrator unverified",
        results,
      },
      null,
      2,
    ),
  );
  console.log(
    `Inkscape: ${results.length} actual low-resolution SVG imports passed.`,
  );
}
