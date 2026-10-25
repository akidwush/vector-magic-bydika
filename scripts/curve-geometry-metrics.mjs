import parse from "svg-path-parser";
const { makeAbsolute } = parse;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
function segmentDistance(p, a, b) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    n = dx * dx + dy * dy,
    t = n
      ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / n))
      : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function cubic(c, depth = 0) {
  if (
    Math.max(
      segmentDistance(c[1], c[0], c[3]),
      segmentDistance(c[2], c[0], c[3]),
    ) <= 0.002
  )
    return [c[0], c[3]];
  if (depth >= 18) throw Error("Metric flattening budget");
  const a = mid(c[0], c[1]),
    b = mid(c[1], c[2]),
    d = mid(c[2], c[3]),
    e = mid(a, b),
    f = mid(b, d),
    g = mid(e, f);
  return [
    ...cubic([c[0], a, e, g], depth + 1).slice(0, -1),
    ...cubic([g, f, d, c[3]], depth + 1),
  ];
}
export function geometry(svg) {
  const paths = [];
  let width = Number(svg.match(/\bwidth="([\d.]+)"/)?.[1]),
    height = Number(svg.match(/\bheight="([\d.]+)"/)?.[1]);
  for (const match of svg.matchAll(/<path\b[^>]*\bd="([^"]+)"[^>]*>/g)) {
    const path = {
      d: match[1],
      anchors: 0,
      curves: 0,
      lines: 0,
      closed: 0,
      subpaths: [],
      edges: [],
    };
    let q = [0, 0],
      start = q,
      previous = null,
      anchors = [];
    function finish() {
      if (anchors.length) {
        if (dist(anchors[0], anchors.at(-1)) < 1e-7 && anchors.length > 1)
          anchors.pop();
        path.anchors += anchors.length;
        path.subpaths.push(anchors);
        anchors = [];
      }
    }
    for (const c of makeAbsolute(parse(match[1]))) {
      const p = [c.x, c.y];
      if (c.code === "M") {
        finish();
        q = start = p;
        anchors.push(p);
        previous = null;
        continue;
      }
      let edge;
      if (c.code === "Z") {
        if (dist(q, start) > 1e-7) {
          edge = [q, start];
          path.lines++;
        }
        path.closed++;
        q = start;
        previous = null;
      } else if (["L", "H", "V"].includes(c.code)) {
        edge = [q, p];
        path.lines++;
        q = p;
        anchors.push(p);
        previous = null;
      } else if (c.code === "C" || c.code === "S") {
        const a =
          c.code === "C"
            ? [c.x1, c.y1]
            : previous
              ? [2 * q[0] - previous[0], 2 * q[1] - previous[1]]
              : q;
        const b = [c.x2, c.y2];
        edge = [q, a, b, p];
        previous = b;
        path.curves++;
        q = p;
        anchors.push(p);
      } else throw Error("Unsupported metric geometry " + c.code);
      if (edge) path.edges.push(edge);
    }
    finish();
    paths.push(path);
  }
  return {
    width,
    height,
    paths,
    anchors: paths.reduce((s, p) => s + p.anchors, 0),
    curves: paths.reduce((s, p) => s + p.curves, 0),
    lines: paths.reduce((s, p) => s + p.lines, 0),
    closed: paths.reduce((s, p) => s + p.closed, 0),
    controls: paths.reduce((s, p) => s + p.curves * 2, 0),
    bytes: Buffer.byteLength(svg),
  };
}
export function chains(g) {
  return g.paths
    .flatMap((p) => p.edges)
    .filter(
      (e) =>
        !e.every((p) => Math.abs(p[0]) < 1e-6) &&
        !e.every((p) => Math.abs(p[1]) < 1e-6) &&
        !e.every((p) => Math.abs(p[0] - g.width) < 1e-6) &&
        !e.every((p) => Math.abs(p[1] - g.height) < 1e-6),
    )
    .map((e) => (e.length === 4 ? cubic(e) : e));
}
function lines(cs) {
  return cs.flatMap((ps) => ps.slice(1).map((p, i) => [ps[i], p]));
}
function samples(cs) {
  const out = [];
  for (const ps of cs)
    for (let i = 1; i < ps.length; i++) {
      const a = ps[i - 1],
        b = ps[i],
        n = Math.max(1, Math.ceil(dist(a, b) / 0.5));
      for (let j = 0; j < n; j++) {
        const t = j / n;
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
  if (out.length > 100000) throw Error("Metric sample budget");
  return out;
}
function index(ls) {
  const grid = new Map();
  for (const [a, b] of ls) {
    for (
      let y = Math.floor(Math.min(a[1], b[1]) / 4);
      y <= Math.floor(Math.max(a[1], b[1]) / 4);
      y++
    )
      for (
        let x = Math.floor(Math.min(a[0], b[0]) / 4);
        x <= Math.floor(Math.max(a[0], b[0]) / 4);
        x++
      ) {
        const k = x + "," + y;
        const bucket = grid.get(k) || [];
        bucket.push([a, b]);
        grid.set(k, bucket);
      }
  }
  return grid;
}
function errors(src, dst) {
  const ls = lines(dst),
    grid = index(ls);
  return samples(src).map((p) => {
    const x = Math.floor(p[0] / 4),
      y = Math.floor(p[1] / 4);
    let best = Infinity;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        for (const [a, b] of grid.get(x + dx + "," + (y + dy)) || [])
          best = Math.min(best, segmentDistance(p, a, b));
    if (best > 4)
      for (const [a, b] of ls) best = Math.min(best, segmentDistance(p, a, b));
    return best;
  });
}
export function boundary(a, b) {
  const e = errors(a, b),
    f = errors(b, a),
    all = [...e, ...f].sort((a, b) => a - b);
  return {
    mean:
      (e.reduce((s, x) => s + x, 0) / e.length +
        f.reduce((s, x) => s + x, 0) / f.length) /
      2,
    p95: all[Math.floor(all.length * 0.95)],
    max: all.at(-1),
  };
}
export function corners(g) {
  const points = [];
  for (const p of g.paths)
    for (const e of p.edges) {
      const q = e[0];
      if (q[0] <= 1 || q[1] <= 1 || q[0] >= g.width - 1 || q[1] >= g.height - 1)
        continue;
      const prev = p.edges.find((e) => dist(e.at(-1), q) < 1e-6);
      if (!prev) continue;
      const before = prev.length === 4 ? prev[2] : prev[0],
        after = e[1],
        u = [q[0] - before[0], q[1] - before[1]],
        v = [after[0] - q[0], after[1] - q[1]],
        n = Math.hypot(...u) * Math.hypot(...v);
      if (
        n &&
        Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / n))) >
          0.65 &&
        !points.some((p) => dist(p, q) < 1e-5)
      )
        points.push(q);
    }
  return points;
}
