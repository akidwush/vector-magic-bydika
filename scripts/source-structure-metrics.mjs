import {
  chains,
  corners,
  pointBoundaryDistance,
} from "./curve-geometry-metrics.mjs";
export function structure(g) {
  const angles = [];
  let cusps = 0;
  for (const path of g.paths) {
    const edges = path.edges;
    for (let i = 0; i < edges.length; i++) {
      const a = edges[(i + edges.length - 1) % edges.length],
        b = edges[i];
      const q = a.at(-1);
      if (Math.hypot(q[0] - b[0][0], q[1] - b[0][1]) > 1e-6) continue;
      const p = a.length === 4 ? a[2] : a[0],
        r = b[1];
      const u = [q[0] - p[0], q[1] - p[1]],
        v = [r[0] - q[0], r[1] - q[1]];
      const den = Math.hypot(...u) * Math.hypot(...v);
      if (!den) continue;
      const angle = Math.acos(
        Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / den)),
      );
      if (angle > 2.6) cusps++;
      if (angle <= 0.65) angles.push(angle);
    }
  }
  const ls = chains(g).flatMap((ps) => ps.slice(1).map((b, i) => [ps[i], b]));
  let crossings = 0;
  const cross = (a, b, c) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < ls.length; i++)
    for (let j = i + 1; j < ls.length; j++) {
      const [a, b] = ls[i],
        [c, d] = ls[j];
      if (
        Math.max(a[0], b[0]) <= Math.min(c[0], d[0]) ||
        Math.max(c[0], d[0]) <= Math.min(a[0], b[0]) ||
        Math.max(a[1], b[1]) <= Math.min(c[1], d[1]) ||
        Math.max(c[1], d[1]) <= Math.min(a[1], b[1])
      )
        continue;
      // Relative SVG parsing can differ at the same endpoint by ~1e-13px.
      // A shared endpoint is not a proper interior crossing.
      if (
        [a, b].some((p) =>
          [c, d].some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6),
        )
      )
        continue;
      if (
        cross(a, b, c) * cross(a, b, d) < -1e-12 &&
        cross(c, d, a) * cross(c, d, b) < -1e-12
      )
        crossings++;
    }
  return {
    closed: g.closed,
    properCrossings: crossings,
    acuteTurnCount: cusps,
    maxSmoothJoinRadians: Math.max(0, ...angles),
  };
}

export function cornerMetrics(g, reference) {
  const points = corners(g),
    available = new Set(points.map((_, i) => i)),
    errors = [];
  for (const p of reference) {
    let best = -1,
      error = 2;
    for (const i of available) {
      const d = Math.hypot(points[i][0] - p[0], points[i][1] - p[1]);
      if (d <= error) {
        best = i;
        error = d;
      }
    }
    if (best >= 0) {
      available.delete(best);
      errors.push(error);
    }
  }
  return {
    precision: points.length
      ? errors.length / points.length
      : reference.length
        ? 0
        : 1,
    recall: reference.length ? errors.length / reference.length : 1,
    unexpected: available.size,
    errors,
    endpointBoundaryErrors: reference.map((p) =>
      pointBoundaryDistance(p, chains(g)),
    ),
    endpointAnchorErrors: reference.map((p) =>
      Math.min(
        ...g.paths.flatMap((path) =>
          path.edges.map((e) => Math.hypot(e[0][0] - p[0], e[0][1] - p[1])),
        ),
      ),
    ),
  };
}
