// Offline ground-truth validation and visual evidence, never run by Convert.
import { chromium } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import {
  chains,
  boundary,
  worstBoundary,
  geometry,
  corners,
} from "./curve-geometry-metrics.mjs";
import { metrics } from "./quality-metrics.mjs";
const root = "benchmark-results/stage15";
await mkdir(root, { recursive: true });
const stretchFailures = [];
const rows = JSON.parse(await readFile(root + "/production.json"));
const browser = await chromium.launch({
  executablePath: process.env.NEXORA_CHROMIUM_PATH,
});
const uri = (svg) =>
  "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
try {
  const page = await browser.newPage();
  const evidence = [];
  for (const row of rows) {
    const { name, width: w, height: h, variants } = row;
    console.log("Measuring", name, row.profile);
    const original = await readFile("tests/fixtures/" + name);
    const mime = name.endsWith(".jpg")
      ? "image/jpeg"
      : name.endsWith(".webp")
        ? "image/webp"
        : "image/png";
    const source = `data:${mime};base64,${original.toString("base64")}`;
    const svgs = await Promise.all(
      variants.map((v) => readFile(`${root}/exports/${v.filename}`, "utf8")),
    );
    const browserMetrics = await page.evaluate(
      async ({ urls, w, h, metricSource, opaque }) => {
        const measure = Function("return (" + metricSource + ")")();
        const rgba = await Promise.all(
          urls.map(async (url) => {
            const im = new Image();
            im.src = url;
            await im.decode();
            const c = document.createElement("canvas");
            c.width = w;
            c.height = h;
            const ctx = c.getContext("2d");
            ctx.drawImage(im, 0, 0, w, h);
            return ctx.getImageData(0, 0, w, h).data;
          }),
        );
        return rgba.slice(1).map((b) => measure(rgba[0], b, w, h, opaque));
      },
      {
        urls: [source, ...svgs.map(uri)],
        w,
        h,
        metricSource: metrics.toString(),
        opaque: !name.includes("partial"),
      },
    );
    assert(
      browserMetrics[1].mae <= browserMetrics[0].mae + 0.15,
      name + ": Chromium MAE regression",
    );
    if (name.includes("partial"))
      assert(browserMetrics[1].iou >= 0.98, name + ": alpha target FAIL");
    let gt, radial, worst, cornerAccuracy;
    if (name.startsWith("curve-optimization/")) {
      const stem = name.replace(/-\d+\.png$/, ".svg");
      const svg = await readFile("tests/fixtures/" + stem, "utf8");
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
        { svg, w },
      );
      gt = variants.map((v) => boundary(reference, chains(v.g)));
      worst = variants.map((v) => worstBoundary(reference, chains(v.g)));
      const expected = corners(geometry(svg)).map((p) =>
        p.map((x) => (x * w) / 256),
      );
      cornerAccuracy = variants.map((v) => {
        const points = corners(v.g),
          available = new Set(points.map((_, i) => i)),
          errors = [];
        for (const p of expected) {
          let best = -1,
            error = 2;
          for (const i of available) {
            const q = points[i];
            const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
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
          expected: expected.length,
          detected: points.length,
          precision: points.length
            ? errors.length / points.length
            : expected.length
              ? 0
              : 1,
          recall: expected.length ? errors.length / expected.length : 1,
          meanPositionError: errors.length
            ? errors.reduce((s, x) => s + x, 0) / errors.length
            : null,
        };
      });

      console.log("GEOMETRY", name, gt);
      if (/\/(cubic|wave)-1024\.png$/.test(name)) {
        assert(
          gt[1].mean < gt[0].mean * 0.7,
          name + ": material mean improvement missing",
        );
        assert(
          gt[1].max < gt[0].max * 0.6,
          name + ": material maximum-error improvement missing",
        );
        if (gt[1].max >= 2)
          stretchFailures.push({
            name,
            max: gt[1].max,
            target: 2,
            status: "FAIL",
          });
        assert(
          browserMetrics[1].mae < browserMetrics[0].mae,
          name + ": actual reconstruction not improved",
        );
      }
      assert(
        gt[1].mean <= gt[0].mean + 0.025,
        name + ": mean ground-truth distance regression",
      );
      assert(
        gt[1].p95 <= gt[0].p95 + 0.04,
        name + ": p95 ground-truth distance regression",
      );
      if (name.includes("dense-circle") || name.includes("dense-ellipse")) {
        const ellipse = name.includes("ellipse");
        const cx = ((ellipse ? 128.2 : 128.35) * w) / 256,
          cy = ((ellipse ? 127.4 : 127.7) * w) / 256;
        const rx = ((ellipse ? 96.3 : 85.3) * w) / 256,
          ry = ((ellipse ? 60.7 : 85.3) * w) / 256;
        radial = variants.map((v) => {
          const points = chains(v.g).flat();
          const x = points.map(
            (p) =>
              Math.abs(Math.hypot((p[0] - cx) / rx, (p[1] - cy) / ry) - 1) *
              Math.min(rx, ry),
          );
          const bounds = [
            Math.min(...points.map((p) => p[0])),
            Math.max(...points.map((p) => p[0])),
            Math.min(...points.map((p) => p[1])),
            Math.max(...points.map((p) => p[1])),
          ];
          return {
            mean: x.reduce((s, x) => s + x, 0) / x.length,
            max: Math.max(...x),
            centerError: Math.hypot(
              (bounds[0] + bounds[1]) / 2 - cx,
              (bounds[2] + bounds[3]) / 2 - cy,
            ),
            radiiError: [
              Math.abs((bounds[1] - bounds[0]) / 2 - rx),
              Math.abs((bounds[3] - bounds[2]) / 2 - ry),
            ],
          };
        });
      }
    }
    const result = {
      name,
      profile: row.profile,
      width: w,
      height: h,
      browserMetrics,
      groundTruth: gt,
      worst,
      cornerAccuracy,
      radial,
      variants: variants.map((v) => ({
        anchors: v.g.anchors,
        controls: v.g.controls,
        curves: v.g.curves,
        lines: v.g.lines,
        paths: v.g.paths.length,
        bytes: v.g.bytes,
        nodesPerPath: v.g.paths.map((p) => p.anchors),
        runtime: v.perf,
        libvips: v.raster,
      })),
      delta: row.delta,
    };
    evidence.push(result);
    const key =
      name.replaceAll("/", "-") +
      (row.profile === "auto" ? "" : "-" + row.profile);
    const box = variants[1].g.paths.at(-1).subpaths.flat();
    const objectTop = Math.min(...box.map((p) => p[1]));
    for (const [scale, focus] of [
      [1, 0],
      [4, 0],
      [10, 0],
      ...(gt?.[1].max >= 2 ? [[10, 1]] : []),
    ]) {
      const size = scale === 1 ? w : Math.min(w, scale === 4 ? 192 : 96);
      const x =
        scale === 1
          ? 0
          : Math.max(
              0,
              Math.min(w - size, (worst?.[focus].point[0] ?? w / 2) - size / 2),
            );
      const y =
        scale === 1
          ? 0
          : Math.max(
              0,
              Math.min(
                h - size,
                (worst?.[focus].point[1] ?? objectTop + size / 6) - size / 2,
              ),
            );
      const side = size * scale;
      const crop = (body) =>
        uri(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" viewBox="${x} ${y} ${size} ${size}">${body}</svg>`,
        );
      const imgs = [
        crop(`<image href="${source}" width="${w}" height="${h}"/>`),
        ...svgs.map((s) =>
          crop(s.replace(/^.*?<svg\b[^>]*>/s, "").replace(/<\/svg>\s*$/, "")),
        ),
      ];
      const labels = [
        "Original raster",
        "Stage 1.4 baseline",
        "Source-refined candidate",
      ];
      await page.setViewportSize({
        width: 3 * (side + 12) + 24,
        height: side + 170,
      });
      await page.setContent(
        `<body style="margin:12px;background:#ddd;font:14px sans-serif"><b>${name} | ${w}×${h} | ${mime} | Illustration / ${row.profile} / VTracer WASM | ${scale * 100}%</b><p>Same source ROI: ${[x, y, size, size].map((n) => n.toFixed(2)).join(", ")}; SVG rendered at target zoom.</p><div style="display:flex;gap:12px">${imgs.map((url, i) => `<figure style="margin:0"><figcaption style="height:40px">${labels[i]}${i ? ` | anchors ${variants[i - 1].g.anchors}, C ${variants[i - 1].g.curves}, paths ${variants[i - 1].g.paths.length}<br>${variants[i - 1].g.bytes} B | ${variants[i - 1].perf.traceMs?.toFixed(1)} ms | GT mean ${gt?.[i - 1].mean.toFixed(4) ?? "n/a"} px` : ""}</figcaption><img width="${side}" height="${side}" src="${url}"/></figure>`).join("")}</div></body>`,
      );
      await page
        .locator("img")
        .evaluateAll((is) => Promise.all(is.map((i) => i.decode())));
      await page.screenshot({
        path:
          root +
          "/" +
          key +
          (focus ? "-remaining" : "") +
          "-" +
          scale * 100 +
          ".png",
        fullPage: true,
      });
    }
    // Actual editable endpoints/handles overlaid only in this diagnostic artifact.
    const overlays = variants.map((v) => {
      const radius = w / 300;
      return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 ${w} ${h}"><image href="${source}" width="${w}" height="${h}" opacity=".25"/><g fill="none" stroke="#d51577" stroke-width="${w / 900}">${v.g.paths.map((p) => `<path d="${p.d}"/>`).join("")}</g><g stroke="#20a099" stroke-width="${w / 1200}" fill="#20a099">${v.g.paths
        .flatMap((p) => p.edges)
        .filter((e) => e.length === 4)
        .map(
          (e) =>
            `<path fill="none" d="M${e[0]}L${e[1]}M${e[2]}L${e[3]}"/><circle cx="${e[1][0]}" cy="${e[1][1]}" r="${radius * 0.6}"/><circle cx="${e[2][0]}" cy="${e[2][1]}" r="${radius * 0.6}"/>`,
        )
        .join("")}</g><g fill="#ff4c00">${v.g.paths
        .flatMap((p) => p.subpaths.flat())
        .map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="${radius}"/>`)
        .join("")}</g></svg>`;
    });
    await page.setViewportSize({ width: 1320, height: 700 });
    await page.setContent(
      `<body style="font:16px sans-serif;background:#eee"><b>${name}: editable anchors (orange), control handles (teal), fitted contour (magenta)</b><div style="display:flex">${overlays.map((s, i) => `<figure style="margin:8px"><figcaption>${i ? "Optimized" : "Baseline"}</figcaption><img src="${uri(s)}"/></figure>`).join("")}</div></body>`,
    );
    await page
      .locator("img")
      .evaluateAll((is) => Promise.all(is.map((i) => i.decode())));
    await page.screenshot({
      path: root + "/" + key + "-handles.png",
      fullPage: true,
    });
  }
  await writeFile(root + "/evidence.json", JSON.stringify(evidence, null, 2));
  await writeFile(
    root + "/stretch-failures.json",
    JSON.stringify(stretchFailures, null, 2),
  );
  console.log(
    "Strict <2px research gate:",
    stretchFailures.length ? "FAIL / PARTIAL" : "PASS",
    stretchFailures,
  );
  console.log(
    `Ground truth, two rasterizers and visual evidence verified for ${evidence.length} comparisons.`,
  );
} finally {
  await browser.close();
}
