// Benchmark-side diagnostics. None of these functions participate in tracing.
import { geometry, chains } from "./curve-geometry-metrics.mjs";
const percentile = (a, p) =>
  a.length
    ? [...a].sort((x, y) => x - y)[
        Math.min(a.length - 1, Math.floor(a.length * p))
      ]
    : null;
export function foreground(rgba, bg = null) {
  const m = new Uint8Array(rgba.length / 4);
  for (let p = 0; p < m.length; p++) {
    const i = p * 4;
    m[p] =
      rgba[i + 3] >= 128 &&
      (!bg || Math.max(...bg.map((v, c) => Math.abs(v - rgba[i + c]))) > 8)
        ? 1
        : 0;
  }
  return m;
}
export function components(mask, w, h) {
  const seen = new Uint8Array(mask.length),
    queue = new Int32Array(mask.length);
  let objects = 0,
    holes = 0;
  for (let p = 0; p < mask.length; p++) {
    if (seen[p]) continue;
    const v = mask[p];
    let n = 1,
      k = 0,
      frame = false;
    queue[0] = p;
    seen[p] = 1;
    while (k < n) {
      const q = queue[k++],
        x = q % w,
        y = Math.floor(q / w);
      if (!x || !y || x === w - 1 || y === h - 1) frame = true;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if ((!dx && !dy) || (v && Math.abs(dx) + Math.abs(dy) !== 1))
            continue;
          const xx = x + dx,
            yy = y + dy,
            j = yy * w + xx;
          if (
            xx >= 0 &&
            xx < w &&
            yy >= 0 &&
            yy < h &&
            !seen[j] &&
            mask[j] === v
          ) {
            seen[j] = 1;
            queue[n++] = j;
          }
        }
    }
    if (n >= 4) {
      if (v) objects++;
      else if (!frame) holes++;
    }
  }
  return {
    objects,
    negativeSpaces: holes,
    definition:
      "4-connected foreground / 8-connected background; components >=4px. White on white is negative space, not certified transparent/path holes.",
  };
}
export function compareRaster(
  a,
  b,
  w,
  h,
  { background = null, maskApplicable = true, rois = [] } = {},
) {
  if (a.length !== w * h * 4 || b.length !== a.length)
    throw Error("RGBA dimensions differ");
  const error = new Float64Array(w * h),
    heat = new Uint8Array(w * h * 4);
  let delta = 0,
    alpha = 0,
    color = 0,
    nColor = 0,
    partial = 0;
  const am = foreground(a, background),
    bm = foreground(b, background);
  let intersection = 0,
    union = 0,
    narrow = 0,
    missingNarrow = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x,
        i = p * 4;
      let d = 0;
      for (let c = 0; c < 4; c++)
        d += Math.abs(
          c === 3
            ? a[i + c] - b[i + c]
            : (a[i + c] * a[i + 3] - b[i + c] * b[i + 3]) / 255,
        );
      error[p] = d / 4;
      delta += d;
      alpha += Math.abs(a[i + 3] - b[i + 3]);
      if (a[i + 3] > 0 && a[i + 3] < 255) partial++;
      if (am[p] && bm[p]) intersection++;
      if (am[p] || bm[p]) union++;
      const get = (m, xx, yy) =>
        xx >= 0 && xx < w && yy >= 0 && yy < h ? m[yy * w + xx] : 0;
      if (
        am[p] &&
        ((!get(am, x - 1, y) && !get(am, x + 1, y)) ||
          (!get(am, x, y - 1) && !get(am, x, y + 1)))
      ) {
        narrow++;
        let found = false;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++)
            if (get(bm, x + dx, y + dy)) found = true;
        if (!found) missingNarrow++;
      }
      if (
        x > 0 &&
        y > 0 &&
        x < w - 1 &&
        y < h - 1 &&
        a[i + 3] === 255 &&
        b[i + 3] === 255
      ) {
        let flat = true;
        for (const j of [i - 4, i + 4, i - w * 4, i + w * 4])
          for (let c = 0; c < 3; c++)
            if (Math.abs(a[i + c] - a[j + c]) > 4) flat = false;
        if (flat) {
          for (let c = 0; c < 3; c++) color += Math.abs(a[i + c] - b[i + c]);
          nColor++;
        }
      }
      heat.set(
        [
          Math.min(255, error[p] * 12),
          Math.min(200, error[p] * 2),
          Math.min(255, error[p] * 6),
          255,
        ],
        i,
      );
    }
  const sums = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += error[y * w + x];
      sums[(y + 1) * (w + 1) + x + 1] = sums[y * (w + 1) + x + 1] + row;
    }
  }
  const boxError = (box) => {
    const [x, y, bw, bh] = box;
    if (bw <= 0 || bh <= 0) return null;
    const k = w + 1;
    return (
      (sums[(y + bh) * k + x + bw] -
        sums[y * k + x + bw] -
        sums[(y + bh) * k + x] +
        sums[y * k + x]) /
      (bw * bh)
    );
  };
  const side = Math.max(8, Math.round(Math.min(w, h) / 16)),
    tiles = [];
  for (let y = 0; y < h; y += Math.max(1, side >> 1))
    for (let x = 0; x < w; x += Math.max(1, side >> 1)) {
      const box = [x, y, Math.min(side, w - x), Math.min(side, h - y)];
      tiles.push({ box, mae: boxError(box) });
    }
  tiles.sort((a, b) => b.mae - a.mae);
  const worst = [];
  for (const t of tiles) {
    if (
      worst.every(
        (s) =>
          Math.abs(s.box[0] - t.box[0]) >= side ||
          Math.abs(s.box[1] - t.box[1]) >= side,
      )
    )
      worst.push(t);
    if (worst.length === 3) break;
  }
  const roiMetrics = rois.map((r) => {
    const [x, y, bw, bh] = r.box;
    const box = [
      Math.max(0, x),
      Math.max(0, y),
      Math.min(bw, w - x),
      Math.min(bh, h - y),
    ];
    return { ...r, box, mae: boxError(box) };
  });
  return {
    mae: delta / a.length,
    alphaMae: alpha / (w * h),
    interiorRgbMae: nColor ? color / (3 * nColor) : null,
    interiorPixels: nColor,
    partialSourcePixels: partial,
    foregroundIoU: maskApplicable && union ? intersection / union : null,
    sourceMask: maskApplicable ? components(am, w, h) : null,
    outputMask: maskApplicable ? components(bm, w, h) : null,
    narrow: maskApplicable
      ? {
          sourcePixels: narrow,
          unsupportedPixels: missingNarrow,
          fraction: narrow ? missingNarrow / narrow : 0,
        }
      : null,
    worst,
    rois: roiMetrics,
    heat,
  };
}
// Exact nearest point in the sampled set. Sampling, not a certified Hausdorff bound.
function tree(ps, depth = 0) {
  if (!ps.length) return null;
  const axis = depth % 2;
  ps.sort((a, b) => a[axis] - b[axis]);
  const m = ps.length >> 1;
  return {
    p: ps[m],
    axis,
    left: tree(ps.slice(0, m), depth + 1),
    right: tree(ps.slice(m + 1), depth + 1),
  };
}
function nearest(t, p, best = Infinity) {
  if (!t) return best;
  const d = p[t.axis] - t.p[t.axis];
  best = Math.min(best, (p[0] - t.p[0]) ** 2 + (p[1] - t.p[1]) ** 2);
  best = nearest(d < 0 ? t.left : t.right, p, best);
  if (d * d < best) best = nearest(d < 0 ? t.right : t.left, p, best);
  return best;
}
export function sampledBoundary(a, b) {
  if (!a.length || !b.length)
    return { status: "UNSUPPORTED", reason: "No visible silhouette samples" };
  if (a.length > 120000 || b.length > 120000)
    return { status: "UNSUPPORTED", reason: "120k point budget" };
  const ta = tree([...a]),
    tb = tree([...b]);
  const x = a.map((p) => Math.sqrt(nearest(tb, p))),
    y = b.map((p) => Math.sqrt(nearest(ta, p))),
    all = [...x, ...y];
  return {
    status: "MEASURED",
    mean:
      (x.reduce((s, v) => s + v, 0) / x.length +
        y.reduce((s, v) => s + v, 0) / y.length) /
      2,
    p95: percentile(all, 0.95),
    max: all.reduce((m, v) => Math.max(m, v), 0),
    worstPoint:
      x.reduce((m, v, i) => (v > x[m] ? i : m), 0) >= 0 &&
      x.reduce((m, v) => Math.max(m, v), 0) >=
        y.reduce((m, v) => Math.max(m, v), 0)
        ? {
            point: a[x.indexOf(x.reduce((m, v) => Math.max(m, v), 0))],
            direction: "reference-to-output",
          }
        : {
            point: b[y.indexOf(y.reduce((m, v) => Math.max(m, v), 0))],
            direction: "output-to-reference",
          },
    referenceSamples: a.length,
    outputSamples: b.length,
    definition:
      "Endpoint-inclusive visible silhouette point-cloud distance, <=0.5px arc-length sampling. Not internal color-boundary error or certified Hausdorff. Visibility uses 2x raster masks.",
  };
}
export function svgComplexity(svg) {
  const g = geometry(svg);
  let length = 0,
    crossings = 0,
    checks = 0;
  const pathBoxes = [],
    pairs = new Set();
  let status = "MEASURED";
  for (const p of g.paths) {
    const segs = [];
    let bbox = [Infinity, Infinity, -Infinity, -Infinity];
    for (const chain of chains({ ...g, paths: [p] })) {
      for (const q of chain) {
        bbox = [
          Math.min(bbox[0], q[0]),
          Math.min(bbox[1], q[1]),
          Math.max(bbox[2], q[0]),
          Math.max(bbox[3], q[1]),
        ];
      }
      for (let i = 1; i < chain.length; i++) {
        length += Math.hypot(
          chain[i][0] - chain[i - 1][0],
          chain[i][1] - chain[i - 1][1],
        );
        segs.push([chain[i - 1], chain[i]]);
      }
    }
    pathBoxes.push(bbox);
    if (status !== "MEASURED") continue;
    const grid = new Map();
    pairs.clear();
    for (let i = 0; i < segs.length; i++) {
      const [a, b] = segs[i],
        x0 = Math.floor(Math.min(a[0], b[0]) / 4),
        x1 = Math.floor(Math.max(a[0], b[0]) / 4),
        y0 = Math.floor(Math.min(a[1], b[1]) / 4),
        y1 = Math.floor(Math.max(a[1], b[1]) / 4);
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const key = x + "," + y,
            ids = grid.get(key) ?? [];
          for (const j of ids) {
            const pair = j + ":" + i;
            if (pairs.has(pair)) continue;
            pairs.add(pair);
            if (++checks > 2000000) {
              status = "BUDGET_EXCEEDED";
              break;
            }
            const [c, d] = segs[j];
            const cross = (p, q, r) =>
              (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
            if (
              cross(a, b, c) * cross(a, b, d) < -1e-12 &&
              cross(c, d, a) * cross(c, d, b) < -1e-12
            )
              crossings++;
          }
          if (status !== "MEASURED") break;
          ids.push(i);
          grid.set(key, ids);
        }
      if (status !== "MEASURED") break;
    }
  }
  const fills = [
    ...new Set(
      [...svg.matchAll(/\bfill="(#[A-Fa-f0-9]+|[a-z]+)"/g)].map((m) => m[1]),
    ),
  ];
  return {
    paths: g.paths.length,
    anchors: g.anchors,
    curves: g.curves,
    lines: g.lines,
    closed: g.closed,
    open: g.paths.reduce(
      (n, p) => n + Math.max(0, p.subpaths.length - p.closed),
      0,
    ),
    colors: fills.length,
    bytes: Buffer.byteLength(svg),
    contourLength: length,
    anchorsPer100px: length ? (g.anchors / length) * 100 : null,
    tinyBBoxPaths: pathBoxes.filter((b) => (b[2] - b[0]) * (b[3] - b[1]) < 4)
      .length,
    compoundPaths: g.paths.filter((p) => p.subpaths.length > 1).length,
    withinPathCrossings: crossings,
    crossingStatus: status,
    crossingChecks: checks,
    masks: (svg.match(/<mask\b/g) || []).length,
    embeddedRaster: /<image\b/i.test(svg),
    definition:
      "All editable paths include opacity masks. Crossings within each path only; intentional crossings remain review candidates, not certified invalid topology.",
  };
}
export const taxonomy = {
  "RECONSTRUCTION.LOCAL":
    "Measured local pixel discrepancy; geometry/color/root cause unassigned.",
  "COLOR.INTERIOR":
    "Flat-interior RGB mismatch; palette/paint hypothesis, not geometric proof.",
  "COLOR.ALPHA":
    "Alpha reconstruction mismatch; intrinsic opacity and edge coverage may differ.",
  "TOPOLOGY.NEGATIVE_SPACE":
    "Foreground-mask negative-space count differs; white regions are not necessarily true holes.",
  "DETAIL.THIN_SUPPORT":
    "Source 1px-wide support has no exported support in a 3x3 neighborhood.",
  "COMPLEXITY.ANCHORS":
    "High anchor density; curvature/detail must be inspected before calling nodes redundant.",
  "COMPLEXITY.TINY_PATHS":
    "Many tiny bounding boxes; some may be intentional decorations or mask paths.",
  "TOPOLOGY.CROSSING_CANDIDATE":
    "Proper within-path crossing found; intended winding semantics require review.",
};
export function classify(r, s) {
  const flags = [];
  const add = (code, evidence) =>
    flags.push({
      code,
      status: "SUSPECTED",
      evidence,
      definition: taxonomy[code],
    });
  if (r.worst[0]?.mae > 12)
    add("RECONSTRUCTION.LOCAL", { worstMae: r.worst[0].mae });
  if (r.interiorRgbMae > 4) add("COLOR.INTERIOR", { rgbMae: r.interiorRgbMae });
  if (r.partialSourcePixels && r.alphaMae > 2)
    add("COLOR.ALPHA", { alphaMae: r.alphaMae });
  if (r.sourceMask?.negativeSpaces !== r.outputMask?.negativeSpaces)
    add("TOPOLOGY.NEGATIVE_SPACE", {
      source: r.sourceMask?.negativeSpaces,
      output: r.outputMask?.negativeSpaces,
    });
  if (r.narrow?.unsupportedPixels > 2) add("DETAIL.THIN_SUPPORT", r.narrow);
  if (s.anchors > 150 && s.anchorsPer100px > 12)
    add("COMPLEXITY.ANCHORS", {
      anchors: s.anchors,
      density: s.anchorsPer100px,
    });
  if (s.tinyBBoxPaths > 16 && s.tinyBBoxPaths / s.paths > 0.15)
    add("COMPLEXITY.TINY_PATHS", { tiny: s.tinyBBoxPaths, paths: s.paths });
  if (s.withinPathCrossings)
    add("TOPOLOGY.CROSSING_CANDIDATE", {
      crossings: s.withinPathCrossings,
      complete: s.crossingStatus === "MEASURED",
    });
  return flags;
}
