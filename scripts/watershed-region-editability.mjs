// Actual Inkscape CLI import/export of downloaded bytes, never a replacement export.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import sharp from "sharp";
import { compareRaster, svgComplexity } from "./real-artwork-metrics.mjs";

const exec = promisify(execFile),
  root = resolve(process.env.NEXORA_ART_ROOT),
  out = root + "/inkscape-proof",
  selected = new Set(
    (
      process.env.NEXORA_WATERSHED_EDIT_IMAGES ??
      "paper-botanical-128,paper-botanical-512,original-garden-512-low-contrast,original-small-symbols-128,paper-harbour-128"
    ).split(","),
  ),
  conversions = (await readFile(root + "/conversions.jsonl", "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse),
  sha = (v) => createHash("sha256").update(v).digest("hex"),
  records = [],
  issues = [];
await mkdir(out);
const version = (await exec("inkscape", ["--version"])).stdout.trim();
for (const c of conversions.filter(
  (v) => selected.has(v.image) && ["A-auto", "combined"].includes(v.config.id),
)) {
  if (c.status !== "EXPORTED") throw Error(c.id + ": missing export");
  const name = c.image + "--" + c.config.id,
    before = await readFile(root + "/" + c.runs[0].export);
  if (sha(before) !== c.runs[0].svgSHA256) throw Error(name + ": hash mismatch");
  const result = await exec(
      "inkscape",
      [
        root + "/" + c.runs[0].export,
        "--export-plain-svg",
        "--export-filename=" + out + "/" + name + ".svg",
      ],
      { timeout: 30000, env: { ...process.env, XDG_CACHE_HOME: out + "/cache" } },
    ),
    after = await readFile(out + "/" + name + ".svg"),
    a = await sharp(before).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    b = await sharp(after).ensureAlpha().raw().toBuffer(),
    metric = compareRaster(a.data, b, a.info.width, a.info.height, {
      maskApplicable: false,
    }),
    complexity = svgComplexity(after.toString());
  await writeFile(out + "/" + name + ".log", result.stdout + result.stderr);
  // A roundtrip is a paint/editability check, not semantic/manual anchor editing.
  if (metric.mae !== 0 || complexity.embeddedRaster || complexity.open)
    issues.push(name + ": changed paint or invalid paths");
  records.push({
    image: c.image,
    config: c.config.id,
    originalSHA256: sha(before),
    roundtripSHA256: sha(after),
    rgbaMAE: metric.mae,
    paths: complexity.paths,
    open: complexity.open,
    embeddedRaster: complexity.embeddedRaster,
  });
}
for (const id of selected)
  if (records.filter((r) => r.image === id).length !== 2)
    issues.push(id + ": incomplete baseline/candidate pair");
const report = {
  status: issues.length ? "FAIL" : "PASS",
  version,
  scope: "Inkscape CLI only. Manual GUI editing and Illustrator UNVERIFIED.",
  records,
  issues,
};
await writeFile(out + "/proof.json", JSON.stringify(report, null, 2));
console.log(report);
if (issues.length) process.exitCode = 1;
