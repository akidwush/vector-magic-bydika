// Three actual browser WASM builds; original raster and retained vector ground truth.
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
import sharp from "sharp";
import {
  geometry,
  chains,
  boundary,
  corners,
  worstBoundary,
} from "./curve-geometry-metrics.mjs";
import { metrics } from "./quality-metrics.mjs";
const root = "benchmark-results/stage16b";
await mkdir(root + "/exports", { recursive: true });
const builds = {
  stage15: root + "/stage15-wasm",
  stage16: root + "/baseline-wasm",
  candidate: "src/engine/wasm",
};
const server = createServer(async (req, res) => {
  const parts = req.url.split("/");
  if (req.url === "/") {
    res.end("<body></body>");
    return;
  }
  const dir = builds[parts[1]],
    file = parts[2];
  if (!dir || !["nexora_wasm.js", "nexora_wasm_bg.wasm"].includes(file)) {
    res.writeHead(404).end();
    return;
  }
  try {
    res.setHeader(
      "Content-Type",
      file.endsWith(".wasm") ? "application/wasm" : "text/javascript",
    );
    res.end(await readFile(dir + "/" + file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(4198, "127.0.0.1", r));
const browser = await chromium.launch({
  executablePath: process.env.NEXORA_CHROMIUM_PATH,
});
const uri = (s) =>
  "data:image/svg+xml;base64," + Buffer.from(s).toString("base64");
function structure(g) {
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
// Metric sanity checks: a bow tie crosses, a numerically identical join does not.
if (
  structure(
    geometry(
      '<svg width="3" height="3"><path d="M.1 .1L1.9 1.9L.1 1.9L1.9 .1Z"/></svg>',
    ),
  ).properCrossings !== 1
)
  throw Error("Crossing metric missed bow tie");
if (
  structure({
    width: 3,
    height: 3,
    closed: 0,
    paths: [
      {
        edges: [
          [
            [0.1, 0.1],
            [1.9, 1.9],
          ],
          [
            [1.9 + 1e-13, 1.9],
            [1.9, 0.1],
          ],
        ],
      },
    ],
  }).properCrossings !== 0
)
  throw Error("Shared join incorrectly counted as crossing");
const rows = [];
try {
  const page = await browser.newPage({ acceptDownloads: true });
  await page.goto("http://127.0.0.1:4198/");
  for (const name of ["cubic", "wave"]) {
    const w = 1024;
    const sourceBytes = await readFile(
      `tests/fixtures/curve-optimization/${name}-${w}.png`,
    );
    const source = await sharp(sourceBytes).ensureAlpha().raw().toBuffer();
    const referenceSVG = await readFile(
      `tests/fixtures/curve-optimization/${name}.svg`,
      "utf8",
    );
    const reference = await page.evaluate(
      ({ svg, w }) => {
        const host = document.createElement("div");
        host.innerHTML = svg;
        document.body.replaceChildren(host);
        const el = host.querySelector("svg").children[1];
        const length = el.getTotalLength();
        const n = Math.ceil((length * w) / 256 / 0.2);
        return [
          Array.from({ length: n + 1 }, (_, i) => {
            const p = el.getPointAtLength((length * i) / n);
            return [(p.x * w) / 256, (p.y * w) / 256];
          }),
        ];
      },
      { svg: referenceSVG, w },
    );
    const expected = corners(geometry(referenceSVG)).map((p) =>
      p.map((v) => v * 4),
    );
    const variants = [];
    const svgs = [];
    for (const key of Object.keys(builds)) {
      const result = await page.evaluate(
        async ({ key, b64, w }) => {
          const m = await import("/" + key + "/nexora_wasm.js");
          const t = performance.now();
          await m.default();
          const initMs = performance.now() - t;
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          const start = performance.now();
          const svg = m.trace_quality(
            bytes,
            w,
            w,
            "illustration",
            "inverse-reduce-reconstruct",
          );
          return {
            svg,
            initMs,
            ms: performance.now() - start,
            inverse: [...m.last_inverse()],
          };
        },
        { key, b64: source.toString("base64"), w },
      );
      const download = page.waitForEvent("download");
      await page.evaluate(
        ({ svg, key }) => {
          const url = URL.createObjectURL(
            new Blob([svg], { type: "image/svg+xml" }),
          );
          const a = document.createElement("a");
          a.href = url;
          a.download = key + ".svg";
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        },
        { svg: result.svg, key },
      );
      await (await download).saveAs(root + `/exports/${name}-${key}.svg`);
      const g = geometry(result.svg);
      const rgba = await sharp(Buffer.from(result.svg))
        .ensureAlpha()
        .raw()
        .toBuffer();
      const detected = corners(g);
      const available = new Set(detected.map((_, i) => i));
      let matched = 0;
      const positions = [];
      for (const p of expected) {
        let best = -1,
          d = 2;
        for (const i of available) {
          const q = detected[i],
            e = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (e <= d) {
            best = i;
            d = e;
          }
        }
        if (best >= 0) {
          available.delete(best);
          matched++;
          positions.push(d);
        }
      }
      variants.push({
        structure: structure(g),
        key,
        initMs: result.initMs,
        ms: result.ms,
        inverse: result.inverse,
        boundary: boundary(reference, chains(g)),
        worst: worstBoundary(reference, chains(g)),
        anchors: g.anchors,
        curves: g.curves,
        paths: g.paths.length,
        bytes: g.bytes,
        cornerPrecision: matched / detected.length,
        cornerRecall: matched / expected.length,
        cornerPositionErrors: positions,
        corners: detected,
        libvips: metrics(source, rgba, w, w, true),
      });
      svgs.push(result.svg);
    }
    const pngUri = "data:image/png;base64," + sourceBytes.toString("base64");
    const browserRaster = await page.evaluate(
      async ({ urls, w, fn }) => {
        const measure = Function("return (" + fn + ")")();
        const data = [];
        for (const url of urls) {
          const im = new Image();
          im.src = url;
          await im.decode();
          const c = document.createElement("canvas");
          c.width = c.height = w;
          const ctx = c.getContext("2d");
          ctx.drawImage(im, 0, 0);
          data.push(ctx.getImageData(0, 0, w, w).data);
        }
        return data.slice(1).map((b) => measure(data[0], b, w, w, true));
      },
      { urls: [pngUri, ...svgs.map(uri)], w, fn: metrics.toString() },
    );
    variants.forEach((v, i) => (v.chromium = browserRaster[i]));
    for (const scale of [1, 4, 10]) {
      const size = scale === 1 ? w : 96;
      const point = variants[0].worst.point;
      const x =
        scale === 1 ? 0 : Math.max(0, Math.min(w - size, point[0] - size / 2));
      const y =
        scale === 1 ? 0 : Math.max(0, Math.min(w - size, point[1] - size / 2));
      const side = size * scale;
      const bodies = [
        `<image href="${pngUri}" width="1024" height="1024"/>`,
        ...svgs.map((s) =>
          s.replace(/^.*?<svg\b[^>]*>/s, "").replace(/<\/svg>\s*$/, ""),
        ),
      ];
      const imgs = bodies.map((body) =>
        uri(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" viewBox="${x} ${y} ${size} ${size}">${body}</svg>`,
        ),
      );
      await page.setViewportSize({
        width: 4 * (side + 12) + 24,
        height: side + 140,
      });
      await page.setContent(
        `<body style="margin:12px;background:#ddd;font:14px sans-serif"><b>${name} 1024 PNG | Illustration | VTracer WASM | ${scale * 100}% | same ROI ${x},${y},${size}</b><div style="display:flex;gap:12px">${imgs.map((src, i) => `<figure style="margin:0"><figcaption style="height:50px">${["Source raster", "Stage 1.5", "Stage 1.6", "1.6B research candidate"][i]}${i ? `<br>${variants[i - 1].anchors} anchors | ${variants[i - 1].ms.toFixed(1)}ms | max ${variants[i - 1].boundary.max.toFixed(4)}px` : ""}</figcaption><img src="${src}" width="${side}" height="${side}"/></figure>`).join("")}</div></body>`,
      );
      await page.screenshot({
        path: root + `/${name}-${scale * 100}.png`,
        fullPage: true,
      });
    }
    rows.push({ name, variants });
    console.log(
      name,
      variants.map((v) => ({ key: v.key, boundary: v.boundary, ms: v.ms })),
    );
  }
  await writeFile(root + "/comparison.json", JSON.stringify(rows, null, 2));
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
