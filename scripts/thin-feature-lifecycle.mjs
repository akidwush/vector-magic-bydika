// Offline source-only life-cycle evidence. State names are hypotheses, not causal proof.
import { readFile, writeFile, readdir } from "node:fs/promises";
import sharp from "sharp";
import { foreground } from "./real-artwork-metrics.mjs";
const root = process.env.NEXORA_THIN_DIAG_ROOT;
if (!root) throw Error("Fresh completed diagnostic directory required");
const summary = JSON.parse(await readFile(root + "/summary.json"));
function regions(mask, w, h) {
  const ids = new Int32Array(mask.length).fill(-1),
    out = [],
    q = new Int32Array(mask.length);
  for (let p = 0; p < mask.length; p++) {
    if (ids[p] >= 0) continue;
    let k = 0,
      n = 1,
      frame = false;
    const v = mask[p],
      id = out.length,
      box = [w, h, 0, 0];
    q[0] = p;
    ids[p] = id;
    while (k < n) {
      const p = q[k++],
        x = p % w,
        y = Math.floor(p / w);
      frame ||= !x || !y || x === w - 1 || y === h - 1;
      box[0] = Math.min(box[0], x);
      box[1] = Math.min(box[1], y);
      box[2] = Math.max(box[2], x);
      box[3] = Math.max(box[3], y);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if ((!dx && !dy) || (v && Math.abs(dx) + Math.abs(dy) !== 1))
            continue;
          const xx = x + dx,
            yy = y + dy,
            j = yy * w + xx;
          if (
            xx >= 0 &&
            yy >= 0 &&
            xx < w &&
            yy < h &&
            ids[j] < 0 &&
            mask[j] === v
          ) {
            ids[j] = id;
            q[n++] = j;
          }
        }
    }
    out.push({
      id,
      value: v,
      area: n,
      frame,
      box,
      pixels: Array.from(q.subarray(0, n)),
    });
  }
  return { ids, out };
}
const files = await readdir(root + "/frames"),
  rows = [];
for (const item of summary) {
  const diag = JSON.parse(
    await readFile(root + "/exports/" + item.id + "-diagnostic.json"),
  );
  const w = diag.width,
    h = diag.height;
  const frameNames = files
    .filter((p) => p.startsWith(item.id + "-") && p.endsWith(".png"))
    .sort(
      (a, b) =>
        Number(a.slice(item.id.length + 1).split("-")[0]) -
        Number(b.slice(item.id.length + 1).split("-")[0]),
    );
  const source = await sharp(root + "/frames/" + frameNames[0])
      .ensureAlpha()
      .raw()
      .toBuffer(),
    bg = Array.from(source.subarray(0, 3));
  const src = regions(foreground(source, bg), w, h);
  const holes = src.out.filter((r) => !r.value && !r.frame && r.area >= 4);
  const stages = [];
  for (const file of frameNames) {
    const index = Number(file.slice(item.id.length + 1).split("-")[0]);
    const rgba = await sharp(root + "/frames/" + file)
      .ensureAlpha()
      .raw()
      .toBuffer();
    let owners = null;
    try {
      const b = await readFile(
        root + "/frames/" + item.id + "-" + index + ".labels",
      );
      if (b.length)
        owners = new Uint32Array(b.buffer, b.byteOffset, b.length / 4);
    } catch {}
    stages.push({
      name: diag.frames[index],
      rgba,
      owners,
      components: regions(foreground(rgba, bg), w, h),
    });
  }
  for (const hole of holes) {
    const border = new Set();
    for (const p of hole.pixels) {
      const x = p % w,
        y = Math.floor(p / w);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const j = (y + dy) * w + x + dx;
        if (
          x + dx >= 0 &&
          x + dx < w &&
          y + dy >= 0 &&
          y + dy < h &&
          src.ids[j] !== hole.id
        )
          border.add(j);
      }
    }
    const history = stages.map((stage) => {
      const overlaps = new Map();
      for (const p of hole.pixels) {
        const id = stage.components.ids[p],
          r = stage.components.out[id];
        if (!r.value && !r.frame && r.area >= 4)
          overlaps.set(id, (overlaps.get(id) || 0) + 1);
      }
      const best = [...overlaps].sort((a, b) => b[1] - a[1])[0];
      let mae = 0;
      for (const p of hole.pixels)
        for (let c = 0; c < 3; c++)
          mae += Math.abs(source[4 * p + c] - stage.rgba[4 * p + c]);
      const counts = new Map();
      if (stage.owners)
        for (const p of hole.pixels) {
          const id = stage.owners[p];
          counts.set(id, (counts.get(id) || 0) + 1);
        }
      const owner = [...counts].sort((a, b) => b[1] - a[1])[0];
      let sameBorder = 0;
      if (owner)
        for (const p of border) if (stage.owners[p] === owner[0]) sameBorder++;
      return {
        stage: stage.name,
        enclosedSupport: (best?.[1] || 0) / hole.area,
        matchingNegativeRegion: best?.[0] ?? null,
        rgbMae: mae / (3 * hole.area),
        dominantOwner: owner?.[0] ?? null,
        ownerFraction: (owner?.[1] || 0) / hole.area,
        sameOwnerBorderFraction: border.size ? sameBorder / border.size : 0,
      };
    });
    const first = history.find((r) => r.enclosedSupport < 0.5);
    let state = "PRESERVED";
    if (first) {
      const merged =
        first.dominantOwner !== null && first.sameOwnerBorderFraction >= 0.5;
      state = !merged
        ? "PRESERVED_BUT_COLOR_DISTORTED"
        : first.stage === "precision-connected-components"
          ? "MERGED_BY_COLOR_PRECISION"
          : first.stage === "color-fit"
            ? "MERGED_DURING_PALETTE_FITTING"
            : first.stage.startsWith("watershed") || first.stage === "clustered"
              ? "LOST_DURING_CLUSTERING"
              : "UNDETERMINED";
    }
    const [l, t, r, b] = hole.box;
    const events = diag.events.filter(
      (e) =>
        e.box &&
        e.box[0] <= r &&
        e.box[1] <= b &&
        e.box[0] + e.box[2] > l &&
        e.box[1] + e.box[3] > t,
    );
    rows.push({
      image: item.id,
      sourceNegativeId: hole.id,
      sourceArea: hole.area,
      box: hole.box,
      widthEstimate:
        (2 * hole.area) / Math.max(1, 2 * (r - l + 1 + (b - t + 1))),
      lengthEstimate: Math.max(r - l + 1, b - t + 1),
      state,
      firstLossStage: first?.stage ?? null,
      history,
      relatedDecisions: events,
      scope:
        "Raster negative component; labels/paint and overlap diagnostic, not certified compound-path topology or semantic identity.",
    });
  }
}
await writeFile(root + "/region-survival.json", JSON.stringify(rows, null, 2));
console.log({
  regions: rows.length,
  states: rows.reduce((a, r) => ((a[r.state] = (a[r.state] || 0) + 1), a), {}),
});
