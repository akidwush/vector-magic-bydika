import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";
import { stats } from "./quality-metrics.mjs";
const rows = JSON.parse(
  await readFile("benchmark-results/quality/full.json", "utf8"),
).results;
const seen = new Set(),
  out = [];
for (const row of rows) {
  const id = row.name + "/" + row.format;
  if (seen.has(id)) continue;
  seen.add(id);
  let image = sharp(await readFile("tests/fixtures/" + row.name));
  if (row.format === "webp")
    image = sharp(await image.webp({ quality: 65 }).toBuffer());
  if (row.format === "jpeg")
    image = sharp(await image.jpeg({ quality: 70 }).toBuffer());
  const { data, info } = await image
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const n = info.width * info.height,
    labels = new Int32Array(n),
    visited = new Uint8Array(n),
    stack = new Int32Array(n);
  let noise = 0,
    edges = 0;
  for (let i = 0; i < n; i++) {
    labels[i] =
      ((data[i * 4] >> 4) << 9) |
      ((data[i * 4 + 1] >> 4) << 5) |
      ((data[i * 4 + 2] >> 4) << 1) |
      (data[i * 4 + 3] >> 7);
    if (i % info.width) {
      const d = Math.max(
        ...[0, 1, 2].map((c) =>
          Math.abs(data[i * 4 + c] - data[(i - 1) * 4 + c]),
        ),
      );
      if (d > 0) edges++;
      if (d > 0 && d <= 32) noise++;
    }
  }
  let connectedRegions = 0,
    tinyRegions = 0;
  for (let i = 0; i < n; i++)
    if (!visited[i]) {
      connectedRegions++;
      let top = 1,
        size = 0;
      stack[0] = i;
      visited[i] = 1;
      while (top) {
        const p = stack[--top];
        size++;
        for (const j of [
          p % info.width ? p - 1 : -1,
          p % info.width < info.width - 1 ? p + 1 : -1,
          p >= info.width ? p - info.width : -1,
          p + info.width < n ? p + info.width : -1,
        ])
          if (j >= 0 && !visited[j] && labels[j] === labels[i]) {
            visited[j] = 1;
            stack[top++] = j;
          }
      }
      if (size <= 4) tinyRegions++;
    }
  out.push({
    name: row.name,
    format: row.format,
    width: info.width,
    height: info.height,
    ...stats(data),
    connectedRegions,
    tinyRegions,
    lowContrastNeighborFraction: noise / Math.max(1, edges),
  });
}
await writeFile(
  "benchmark-results/quality/source-audit.json",
  JSON.stringify(out, null, 2),
);
console.log(
  "Audited",
  out.length,
  "source variants using independent decoder and quantized 4-connected regions",
);
