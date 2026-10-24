import parse from "svg-path-parser";
const { makeAbsolute } = parse;
const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-5;
const round = (p) => p.map((v) => Math.round(v * 1e6) / 1e6);
export function primitives(svg) {
  const paths = [];
  for (const m of svg.matchAll(/<path\b[^>]*\bd="([^"]+)"[^>]*>/g)) {
    let a = [0, 0],
      start = a,
      prev = null;
    const edges = [];
    for (const c of makeAbsolute(parse(m[1]))) {
      const b = [c.x, c.y];
      let points = null;
      if (c.code === "M") {
        a = b;
        start = b;
        prev = null;
        continue;
      }
      if (c.code === "Z") {
        if (!near(a, start)) points = [a, start];
      } else if (["L", "H", "V"].includes(c.code)) points = [a, b];
      else if (c.code === "C") points = [a, [c.x1, c.y1], [c.x2, c.y2], b];
      else if (c.code === "S")
        points = [
          a,
          prev ? [2 * a[0] - prev[0], 2 * a[1] - prev[1]] : a,
          [c.x2, c.y2],
          b,
        ];
      else throw new Error("Unsupported geometry in topology metric " + c.code);
      if (points) edges.push(points.map(round));
      a = c.code === "Z" ? start : b;
      prev = points?.length === 4 ? points[2] : null;
    }
    paths.push({ d: m[1], edges });
  }
  return paths;
}
export function coincidence(svg, w = 128, h = 128) {
  const paths = primitives(svg),
    table = new Map();
  let count = 0,
    interior = 0,
    unmatchedInterior = 0;
  for (let face = 0; face < paths.length; face++)
    for (const points of paths[face].edges) {
      if (near(points[0], points.at(-1)) && points.length === 2) continue;
      const f = JSON.stringify(points),
        r = JSON.stringify([...points].reverse());
      const key = f < r ? f : r;
      const list = table.get(key) || [];
      list.push({ face, points });
      table.set(key, list);
      count++;
    }
  let paired = 0;
  for (const list of table.values()) {
    const points = list[0].points;
    const frame =
      points.every((p) => p[0] === 0) ||
      points.every((p) => p[0] === w) ||
      points.every((p) => p[1] === 0) ||
      points.every((p) => p[1] === h);
    if (!frame) {
      interior += list.length;
      if (
        list.length !== 2 ||
        list[0].face === list[1].face ||
        JSON.stringify(list[0].points) !==
          JSON.stringify([...list[1].points].reverse())
      )
        unmatchedInterior += list.length;
      else paired += 2;
    }
  }
  return {
    paths: paths.length,
    primitives: count,
    interiorPrimitives: interior,
    paired,
    unmatchedInterior,
    coincidence: interior ? paired / interior : 1,
  };
}
// Independent browser geometric coverage, not renderer alpha or a white-background heuristic.
function flattenedPaths(svg) {
  const cache = new Map();
  const d = (p, a, b) => {
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      n = dx * dx + dy * dy;
    const t = n
      ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / n))
      : 0;
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  };
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  function flatten(c, out, depth = 0) {
    if (
      depth === 20 ||
      Math.max(d(c[1], c[0], c[3]), d(c[2], c[0], c[3])) < 0.0001
    ) {
      out.push(c[3]);
      return;
    }
    const a = mid(c[0], c[1]),
      b = mid(c[1], c[2]),
      e = mid(c[2], c[3]),
      f = mid(a, b),
      g = mid(b, e),
      h = mid(f, g);
    flatten([c[0], a, f, h], out, depth + 1);
    flatten([h, g, e, c[3]], out, depth + 1);
  }
  return primitives(svg).map(({ edges }) =>
    edges.flatMap((points) => {
      const f = JSON.stringify(points),
        r = JSON.stringify([...points].reverse()),
        forward = f <= r,
        key = forward ? f : r;
      if (!cache.has(key)) {
        const canonical = forward ? points : [...points].reverse(),
          ps = [canonical[0]];
        if (points.length === 2) ps.push(canonical[1]);
        else flatten(canonical, ps);
        cache.set(key, ps);
      }
      const ps = forward ? cache.get(key) : [...cache.get(key)].reverse();
      return ps.slice(1).map((b, i) => [ps[i], b]);
    }),
  );
}
export async function coverageMetrics(page, svg, w = 128, h = 128) {
  // Deterministic scanline winding of parsed geometry. Canonical shared cubics
  // are flattened once to .0001px and reversed exactly, independently of Skia.
  const paths = flattenedPaths(svg);
  let gap = 0,
    overlap = 0,
    total = 0,
    boundarySamples = 0;
  for (let y = 0; y < h; y++)
    for (const dy of [0.25, 0.75]) {
      const yy = y + dy;
      const crossings = paths.map((lines) =>
        lines.flatMap(([a, b]) => {
          if (!((a[1] <= yy && b[1] > yy) || (b[1] <= yy && a[1] > yy)))
            return [];
          return [
            [
              a[0] + ((yy - a[1]) * (b[0] - a[0])) / (b[1] - a[1]),
              b[1] > a[1] ? 1 : -1,
            ],
          ];
        }),
      );
      for (let x = 0; x < w; x++)
        for (const dx of [0.25, 0.75]) {
          const xx = x + dx;
          let hits = 0,
            boundary = false;
          for (const cs of crossings) {
            let winding = 0;
            for (const [cx, sign] of cs) {
              if (Math.abs(cx - xx) < 1e-6) boundary = true;
              if (cx > xx) winding += sign;
            }
            hits += winding !== 0;
          }
          if (boundary) {
            boundarySamples++;
            continue;
          }
          gap += hits === 0;
          overlap += hits > 1;
          total++;
        }
    }
  const renderer = await page.evaluate(
    ({ svg, w, h }) =>
      new Promise((resolve, reject) => {
        const canvas = document.createElement("canvas"),
          ctx = canvas.getContext("2d"),
          img = new Image();
        img.onerror = reject;
        img.onload = () => {
          const renderer = [];
          for (const scale of [1, 4, 10]) {
            canvas.width = w * scale;
            canvas.height = h * scale;
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const rgba = ctx.getImageData(
              0,
              0,
              canvas.width,
              canvas.height,
            ).data;
            let seamPixels = 0,
              maxDeficit = 0;
            for (let y = scale; y < canvas.height - scale; y++)
              for (let x = scale; x < canvas.width - scale; x++) {
                const a = rgba[(y * canvas.width + x) * 4 + 3];
                if (a < 250) {
                  seamPixels++;
                  maxDeficit = Math.max(maxDeficit, 255 - a);
                }
              }
            renderer.push({ scale, seamPixels, maxAlphaDeficit: maxDeficit });
          }
          resolve(renderer);
        };
        img.src = "data:image/svg+xml;base64," + btoa(svg);
      }),
    { svg, w, h },
  );
  return {
    geometricGapSamples: gap,
    geometricOverlapSamples: overlap,
    total,
    boundarySamples,
    renderer,
  };
}

export function organicFeatures(source, output) {
  const dark = (buf, i) =>
    Math.hypot(buf[i] - 23, buf[i + 1] - 46, buf[i + 2] - 56) < 70;
  return [
    [41, 61, 55, 75],
    [74, 61, 88, 75],
    [57, 80, 73, 93],
  ].map(([x0, y0, x1, y1]) => {
    let intersection = 0,
      union = 0;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = (y * 128 + x) * 4,
          a = dark(source, i),
          b = dark(output, i);
        intersection += a && b;
        union += a || b;
      }
    return union ? intersection / union : 0;
  });
}
