// Read-only measured ownership/paint lineage; no reference or semantic labels.
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
const root = process.env.NEXORA_THIN_DIAG_ROOT,
  fixtures = process.env.NEXORA_ART_FIXTURES ?? "tests/fixtures/real-artwork",
  summary = JSON.parse(await readFile(root + "/summary.json")),
  manifest = JSON.parse(await readFile(fixtures + "/manifest.json")),
  all = [];
const reasons = {
  "watershed-cut": "WATERSHED_CUT_MERGE",
  "watershed-snapped": "BOUNDARY_SNAP_CHANGE",
  "watershed-area-filtered": "SMALL_BASIN_ABSORPTION",
  "color-fit": "PALETTE_COLOR_COLLAPSE",
  "mosaic-before-color-merge": "UNDETERMINED",
  "mosaic-after-color-merge": "MOSAIC_ADJACENCY_MERGE",
};
for (const item of summary) {
  const record = JSON.parse(await readFile(root + "/" + item.id + ".json")),
    source = manifest.images.find((x) => x.id === item.id),
    w = record.diagnostic.width,
    h = record.diagnostic.height,
    n = w * h;
  if (n > 512 * 512) throw Error("diagnostic pixel cap");
  const raw = await sharp(
      await readFile(root + "/frames/" + item.id + "-0-source.png"),
    )
      .ensureAlpha()
      .raw()
      .toBuffer(),
    stages = [];
  let previous = null;
  for (const f of record.stages.filter((x) => Number.isInteger(x.index))) {
    const bytes = await readFile(
      root + "/frames/" + item.id + "-" + f.index + ".labels",
    );
    if (!bytes.length) continue;
    if (bytes.length !== n * 4) throw Error("invalid label bytes");
    const labels = new Uint32Array(n);
    for (let i = 0; i < n; i++) labels[i] = bytes.readUInt32LE(i * 4);
    const paint = await sharp(
        await readFile(
          root + "/frames/" + item.id + "-" + f.index + "-" + f.stage + ".png",
        ),
      )
        .ensureAlpha()
        .raw()
        .toBuffer(),
      regions = new Map(),
      adj = new Map(),
      overlap = new Map();
    for (let i = 0; i < n; i++) {
      const id = labels[i];
      if (id === 0xffffffff) continue;
      let r = regions.get(id);
      if (!r) {
        r = {
          id,
          area: 0,
          bbox: [w, h, 0, 0],
          sourceSum: [0, 0, 0],
          sourceSquare: [0, 0, 0],
          paint: [],
          sourceForeground: 0,
          neighbors: new Map(),
        };
        regions.set(id, r);
        if (regions.size > 4096) throw Error("diagnostic region cap");
      }
      const x = i % w,
        y = Math.floor(i / w);
      r.area++;
      r.bbox = [
        Math.min(r.bbox[0], x),
        Math.min(r.bbox[1], y),
        Math.max(r.bbox[2], x),
        Math.max(r.bbox[3], y),
      ];
      r.paint = [...paint.subarray(i * 4, i * 4 + 4)];
      for (let c = 0; c < 3; c++) {
        r.sourceSum[c] += raw[i * 4 + c];
        r.sourceSquare[c] += raw[i * 4 + c] ** 2;
      }
      if (
        raw[i * 4 + 3] >= 128 &&
        Math.max(
          ...source.background.map((v, c) => Math.abs(v - raw[i * 4 + c])),
        ) > 8
      )
        r.sourceForeground++;
      if (previous) {
        const key = previous[i] + ":" + id;
        overlap.set(key, (overlap.get(key) ?? 0) + 1);
      }
      for (const q of [x + 1 < w ? i + 1 : -1, y + 1 < h ? i + w : -1])
        if (q >= 0 && labels[q] !== id && labels[q] !== 0xffffffff) {
          const a = Math.min(id, labels[q]),
            b = Math.max(id, labels[q]),
            key = a + ":" + b;
          let e = adj.get(key);
          if (!e) {
            e = { regions: [a, b], length: 0, sourceContrastSum: 0 };
            adj.set(key, e);
          }
          e.length++;
          e.sourceContrastSum += Math.max(
            ...[0, 1, 2].map((c) => Math.abs(raw[i * 4 + c] - raw[q * 4 + c])),
          );
        }
    }
    for (const e of adj.values()) {
      for (const [a, b] of [e.regions, [...e.regions].reverse()])
        regions.get(a)?.neighbors.set(b, e.length);
    }
    const lineage = [...overlap].map(([k, pixels]) => {
        const [old, id] = k.split(":").map(Number);
        return { previousRegion: old, currentRegion: id, pixels };
      }),
      incoming = new Map(),
      outgoing = new Map();
    for (const t of lineage) {
      if (!incoming.has(t.currentRegion)) incoming.set(t.currentRegion, []);
      incoming.get(t.currentRegion).push(t.previousRegion);
      if (!outgoing.has(t.previousRegion)) outgoing.set(t.previousRegion, []);
      outgoing.get(t.previousRegion).push(t.currentRegion);
    }
    stages.push({
      stage: f.stage,
      index: f.index,
      reason: reasons[f.stage] ?? "UNDETERMINED",
      regionCount: regions.size,
      visibleSourceMask: f.sourceMask,
      visiblePaintMask: f.outputMask,
      rgbaMAE: f.mae,
      regions: [...regions.values()].map((r) => ({
        id: r.id,
        area: r.area,
        bbox: [
          r.bbox[0],
          r.bbox[1],
          r.bbox[2] - r.bbox[0] + 1,
          r.bbox[3] - r.bbox[1] + 1,
        ],
        sourceMean: r.sourceSum.map((x) => x / r.area),
        sourceStd: r.sourceSquare.map((x, c) =>
          Math.sqrt(Math.max(0, x / r.area - (r.sourceSum[c] / r.area) ** 2)),
        ),
        paint: r.paint,
        sourceForegroundSupport: r.sourceForeground,
        sourceBackgroundSupport: r.area - r.sourceForeground,
        neighbors: [...r.neighbors].map(([id, boundaryLength]) => ({
          id,
          boundaryLength,
        })),
      })),
      boundaries: [...adj.values()].map((e) => ({
        ...e,
        meanSourceAdjacentLinf: e.sourceContrastSum / e.length,
      })),
      lineage,
      mergedPreviousRegions: [...incoming].filter(([, v]) => v.length > 1),
      splitPreviousRegions: [...outgoing].filter(([, v]) => v.length > 1),
      interpretation:
        "Overlap records measure membership, not semantic shapes. Region counts, visible components and compound-path holes differ. Boundary adjacent-pixel contrast is diagnostic, not the multiscale protection classifier.",
    });
    previous = labels;
  }
  all.push({
    image: item.id,
    sourceSHA256: record.sourceSHA256,
    exportSHA256: record.svgSHA256,
    selection: record.diagnostic.watershed,
    stages,
  });
}
await writeFile(
  root + "/region-transitions.json",
  JSON.stringify(
    {
      policy:
        "Source-only diagnostics. Reason names identify executed pipeline stages; not every merge is a defect. No global-ID inequality is treated as loss; overlap lineage makes renumbering explicit.",
      images: all,
    },
    null,
    2,
  ),
);
console.log({
  images: all.length,
  stages: all.reduce((n, r) => n + r.stages.length, 0),
});
