// Optional real Inkscape CLI import / editable plain SVG roundtrip, not a GUI test.
import { spawnSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import sharp from "sharp";
import { geometry } from "./curve-geometry-metrics.mjs";
import { metrics } from "./quality-metrics.mjs";
const evidenceRoot = process.env.NEXORA_STAGE15_ROOT || "benchmark-results/stage15";
const root = resolve(evidenceRoot + "/inkscape");
await mkdir(root, { recursive: true });
const env = { ...process.env, INKSCAPE_PROFILE_DIR: root + "/profile" };
const version = spawnSync("inkscape", ["--version"], { encoding: "utf8", env });
if (version.error?.code === "ENOENT") {
  await writeFile(
    root + "/results.json",
    JSON.stringify({ status: "unverified", reason: "Inkscape unavailable" }),
  );
  console.log("Inkscape unavailable; import compatibility remains unverified.");
} else {
  assert.equal(version.status, 0, version.stderr);
  const rows = JSON.parse(
    await readFile(evidenceRoot + "/production.json"),
  );
  const results = [];
  for (const name of [
    "curve-optimization/cubic-1024.png",
    "curve-optimization/wave-1024.png",
    "shared-edge/organic.png",
    "quality/cat-128-partial.png",
  ]) {
    const row = rows.find((r) => r.name === name && r.profile === "auto");
    const v = row.variants[1];
    const input = resolve(evidenceRoot + "/exports", v.filename),
      plain = root + "/" + name.replaceAll("/", "-") + ".svg",
      png = plain + ".png";
    for (const args of [
      [input, "--export-plain-svg", "--export-filename=" + plain],
      [plain, "--export-type=png", "--export-filename=" + png],
    ]) {
      const r = spawnSync("inkscape", args, {
        encoding: "utf8",
        env,
        timeout: 60000,
      });
      assert.equal(r.status, 0, r.stderr);
    }
    const svg = await readFile(plain, "utf8");
    assert(!/<image\b/i.test(svg), name + ": embedded raster after import");
    const g = geometry(svg);
    assert.equal(g.anchors, v.g.anchors, name + ": editable anchors changed");
    const source = await sharp("tests/fixtures/" + name)
      .ensureAlpha()
      .raw()
      .toBuffer();
    const output = await sharp(png).ensureAlpha().raw().toBuffer();
    const quality = metrics(
      source,
      output,
      row.width,
      row.height,
      !name.includes("partial"),
    );
    assert(quality.mae <= v.raster.mae + 0.3, name + ": Inkscape export drift");
    if (name.includes("partial"))
      assert(quality.iou >= 0.98, name + ": alpha import target FAIL");
    results.push({ name, anchors: g.anchors, paths: g.paths.length, quality });
  }
  await writeFile(
    root + "/results.json",
    JSON.stringify(
      {
        version: version.stdout.trim(),
        status:
          "CLI import/plain SVG and PNG export verified; GUI anchor editing not exercised",
        results,
      },
      null,
      2,
    ),
  );
  console.log(
    `Inkscape CLI: ${results.length} real SVG imports and editable roundtrips passed.`,
  );
}
