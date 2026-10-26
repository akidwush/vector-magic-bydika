import { readFile, writeFile } from "node:fs/promises";
import { geometry, corners } from "./curve-geometry-metrics.mjs";
const root = process.env.NEXORA_PROOF_DIR + "/false-corner/low-resolution";
const rows = JSON.parse(await readFile(root + "/comparison.json"));
const row = rows.find((r) => r.key === "wave-128"),
  [b, c] = row.variants;
const svgs = await Promise.all(
  [b, c].map((v) => readFile(root + "/exports/" + v.filename, "utf8")),
);
const accepted = [];
for (let i = 3; i < c.continuity.length; i += 16) {
  const d = c.continuity.slice(i, i + 16);
  if (d[2] === 2 && d[5] === 0) accepted.push(d);
}
const colors = {
  TRUE_HARD_CORNER: "#007f35",
  SMOOTH_JOIN: "#1671cb",
  FALSE_CORNER: "#dc2525",
  JUNCTION_LOCKED: "#6d4897",
  UNCERTAIN: "#b67d00",
};
const norm = (v) => Math.hypot(...v),
  line = (p, q, color) =>
    `<path d="M${p}L${q}" fill="none" stroke="${color}" stroke-width=".15"/>`;
const panels = svgs.map((svg, index) => {
  const g = geometry(svg);
  const points = corners(g);
  let handles = "";
  for (const path of g.paths)
    for (const edge of path.edges) {
      if (edge.length !== 4) continue;
      for (const [a, z] of [
        [edge[0], edge[1]],
        [edge[3], edge[2]],
      ])
        handles += line(a, z, "#888");
    }
  let labels = "";
  for (const path of g.paths)
    for (const edge of path.edges) {
      const q = edge[0],
        falsePoint = accepted.some(
          (d) => Math.hypot(d[0] - q[0], d[1] - q[1]) < 0.1,
        );
      const hard = points.some((p) => norm([p[0] - q[0], p[1] - q[1]]) < 0.01);
      const cls = falsePoint
        ? "FALSE_CORNER"
        : hard
          ? "TRUE_HARD_CORNER"
          : "SMOOTH_JOIN";
      labels += `<circle cx="${q[0]}" cy="${q[1]}" r=".45" fill="${colors[cls]}"/>`;
    }
  const body = svg.replace(/^.*?<svg\b[^>]*>/s, "").replace(/<\/svg>\s*$/, "");
  return `<g transform="translate(${index * 134},8)">${body}${handles}${labels}<text x="2" y="-2" font-size="3">${index ? "Stage 1.6D" : "Stage 1.6C"}: tangent handles + final joins</text></g>`;
});
const legend = Object.entries(colors)
  .map(
    ([label, color], i) =>
      `<text x="${i * 54}" y="145" fill="${color}" font-size="2.8">${label}</text>`,
  )
  .join("");
await writeFile(
  root + "/wave-128-tangents.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" width="1608" height="900" viewBox="0 0 268 150"><rect width="268" height="150" fill="white"/>${panels.join("")}${legend}<text x="2" y="149" font-size="2.5">Red: accepted source-disproved splices. No junctions in this owned ring. Other uncertain/rejected cases remain unchanged.</text></svg>`,
);
console.log(
  "Retained actual exports and independent tangent/anchor visualization.",
);
const curvature = [];
for (let variant = 0; variant < 2; variant++) {
  const g = geometry(svgs[variant]);
  let arc = 0;
  for (const [edge, c] of g.paths[1].edges.entries()) {
    if (c.length !== 4) continue;
    let prev = c[0];
    for (let j = 0; j <= 32; j++) {
      const t = j / 32,
        u = 1 - t;
      const p = [0, 1].map(
        (k) =>
          u * u * u * c[0][k] +
          3 * u * u * t * c[1][k] +
          3 * u * t * t * c[2][k] +
          t * t * t * c[3][k],
      );
      const v = [0, 1].map(
        (k) =>
          3 *
          (u * u * (c[1][k] - c[0][k]) +
            2 * u * t * (c[2][k] - c[1][k]) +
            t * t * (c[3][k] - c[2][k])),
      );
      const a = [0, 1].map(
        (k) =>
          6 *
          (u * (c[2][k] - 2 * c[1][k] + c[0][k]) +
            t * (c[3][k] - 2 * c[2][k] + c[1][k])),
      );
      arc += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      prev = p;
      curvature.push({
        variant,
        edge,
        t,
        arc,
        x: p[0],
        y: p[1],
        curvature:
          (v[0] * a[1] - v[1] * a[0]) / Math.max(1e-12, Math.hypot(...v) ** 3),
      });
    }
  }
}
await writeFile(
  root + "/wave-128-curvature.json",
  JSON.stringify(curvature, null, 2),
);
const plots = [0, 1].map((i) => {
  const pts = curvature.filter((p) => p.variant === i),
    max = Math.max(...pts.map((p) => p.arc));
  return `<g transform="translate(${20 + i * 650},20)"><text y="15">${i ? "Stage 1.6D" : "Stage 1.6C"}: signed curvature, graph clipped to ±2/px</text><path d="M0,180H620M0,30V330" stroke="#aaa" fill="none"/><polyline fill="none" stroke="${i ? "#007f35" : "#dc2525"}" points="${pts.map((p) => `${(620 * p.arc) / max},${180 - 75 * Math.max(-2, Math.min(2, p.curvature))}`).join(" ")}"/><text y="365">Arclength along curved contour; raw unclipped samples retained in JSON.</text></g>`;
});
await writeFile(
  root + "/wave-128-curvature.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" width="1340" height="430"><rect width="1340" height="430" fill="white"/>${plots.join("")}</svg>`,
);
const { default: sharp } = await import("sharp");
const src = await sharp("tests/fixtures/curve-optimization/wave-128.png")
  .ensureAlpha()
  .raw()
  .toBuffer();
const patch = { x: 14, y: 76, width: 16, height: 15 };
const project = (c, b) => {
  const a = [36, 90, 183],
    d = a.map((v) => v - b);
  return Math.max(
    0,
    Math.min(
      1,
      d.reduce((s, v, k) => s + (c[k] - b) * v, 0) /
        d.reduce((s, v) => s + v * v, 0),
    ),
  );
};
const valley = [];
for (let variant = 0; variant < 2; variant++) {
  const out = await sharp(Buffer.from(svgs[variant]))
    .ensureAlpha()
    .raw()
    .toBuffer();
  let cov = 0,
    rgb = 0,
    count = 0;
  for (let y = patch.y; y < patch.y + patch.height; y++)
    for (let x = patch.x; x < patch.x + patch.width; x++) {
      const i = (y * 128 + x) * 4,
        a = src.subarray(i, i + 3),
        b = out.subarray(i, i + 3);
      cov += (project(a, 255) - project(b, 254)) ** 2;
      for (let k = 0; k < 3; k++) rgb += Math.abs(a[k] - b[k]);
      count++;
    }
  valley.push({
    variant: variant ? "stage16d" : "stage16c",
    patch,
    coverageMSE: cov / count,
    rgbMAE: rgb / (count * 3),
    method:
      "independent libvips rasterization of final SVG; encoded-sRGB two-paint projection",
  });
}
await writeFile(root + "/valley.json", JSON.stringify(valley, null, 2));
if (!(
  valley[1].coverageMSE < valley[0].coverageMSE &&
  valley[1].rgbMAE < valley[0].rgbMAE
))
  throw Error("Final exported valley reconstruction regressed");
const sharedFile =
  process.env.NEXORA_STAGE15_ROOT +
  "/exports/shared-edge-organic.png-planar-candidate.svg";
const shared = await readFile(sharedFile, "utf8"),
  sg = geometry(shared),
  incidence = new Map();
const key = (q) => q.map((v) => v.toFixed(6)).join(",");
for (const path of sg.paths)
  for (const edge of path.edges) {
    const forward = edge.map(key).join(";"),
      reverse = [...edge].reverse().map(key).join(";"),
      id = [forward, reverse].sort()[0];
    for (const q of [edge[0], edge.at(-1)]) {
      const k = key(q);
      if (!incidence.has(k)) incidence.set(k, new Set());
      incidence.get(k).add(id);
    }
  }
const junctions = [...incidence]
  .filter(([, es]) => es.size >= 3)
  .map(([q]) => q.split(",").map(Number));
const markers = junctions
  .map(
    (q) =>
      `<circle cx="${q[0]}" cy="${q[1]}" r=".8" fill="#6d4897" stroke="white" stroke-width=".15"/>`,
  )
  .join("");
await writeFile(
  root + "/shared-junctions.svg",
  shared.replace("</svg>", markers + "</svg>"),
);
await writeFile(
  root + "/shared-junctions.json",
  JSON.stringify(
    {
      definition:
        "unique incident serialized geometries >=3, rounded at existing six-place precision",
      class: "JUNCTION_LOCKED",
      junctions,
      source:
        "existing planar export; excluded from independent continuity fitting",
    },
    null,
    2,
  ),
);
