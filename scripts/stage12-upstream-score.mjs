import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
const bin =
  process.env.NEXORA_UPSTREAM_BENCH ||
  "/workspace/nexora-upstream-vtracer/target/release/vtracer-bench";
const results = JSON.parse(
    await readFile("benchmark-results/stage12/full.json", "utf8"),
  ).results,
  scored = [];
for (const row of results) {
  if (
    (
      await sharp("tests/fixtures/" + row.name)
        .ensureAlpha()
        .stats()
    ).channels[3]?.min < 255
  )
    continue;
  const id = row.name.replaceAll("/", "-") + "-" + row.candidate;
  for (const suffix of ["", "-source"])
    await sharp(`benchmark-results/stage12/${id}${suffix}.png`)
      .flatten({ background: "#fff" })
      .png()
      .toFile(`benchmark-results/stage12/${id}${suffix}-rgb.png`);
  const text = execFileSync(
    bin,
    [
      `benchmark-results/stage12/${id}-source-rgb.png`,
      `benchmark-results/stage12/${id}-rgb.png`,
    ],
    { encoding: "utf8" },
  );
  scored.push({ name: row.name, candidate: row.candidate, output: text });
}
await writeFile(
  "benchmark-results/stage12/upstream-fidelity.json",
  JSON.stringify(scored, null, 2),
);
console.log(
  "Upstream blind fidelity scored",
  scored.length,
  "opaque reconstructions",
);
