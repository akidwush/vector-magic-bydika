// Offline ground-truth validation and visual evidence, never run by Convert.
import { chromium } from "@playwright/test";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { chains, boundary } from "./curve-geometry-metrics.mjs";
import { metrics } from "./quality-metrics.mjs";
const root = "benchmark-results/stage14";
await mkdir(root, { recursive: true });
const rows = JSON.parse(await readFile(root + "/production.json"));
const folder = (await readdir("test-results")).find((n) =>
  n.startsWith("curve-optimization-curve-o"),
);
assert(folder, "Missing browser exports; run curve-optimization.spec.ts first");
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
      variants.map((v) =>
        readFile(`test-results/${folder}/${v.filename}`, "utf8"),
      ),
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
    let gt, radial;
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
        if (w === 1024) {
          assert(
            gt[1].mean < gt[0].mean * 0.7,
            name + ": expected large-contour improvement missing",
          );
          assert(radial[1].max < 0.3, name + ": primitive shape drift");
        }
      }
    }
    const result = {
      name,
      profile: row.profile,
      width: w,
      height: h,
      browserMetrics,
      groundTruth: gt,
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
    const show = [
      "curve-optimization/dense-circle-1024.png",
      "curve-optimization/dense-ellipse-1024.png",
      "curve-optimization/rounded-512.png",
      "curve-optimization/cubic-1024.png",
      "curve-optimization/organic-512.png",
      "curve-optimization/wave-512.png",
      "shared-edge/organic.png",
      "quality/cat-128-partial.png",
      "corners/star-128.png",
    ];
    if (!show.includes(name) || row.profile !== "auto") continue;
    const box = variants[1].g.paths.at(-1).subpaths.flat();
    const objectTop = Math.min(...box.map((p) => p[1]));
    for (const scale of [1, 4, 10]) {
      const size = scale === 1 ? w : Math.min(w, scale === 4 ? 192 : 96);
      const x =
        scale === 1 ? 0 : Math.max(0, Math.min(w - size, w / 2 - size / 2));
      const y =
        scale === 1 ? 0 : Math.max(0, Math.min(h - size, objectTop - size / 3));
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
      const labels = ["Original raster", "Baseline SVG", "Optimized SVG"];
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
          root + "/" + name.replaceAll("/", "-") + "-" + scale * 100 + ".png",
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
      path: root + "/" + name.replaceAll("/", "-") + "-handles.png",
      fullPage: true,
    });
  }
  await writeFile(root + "/evidence.json", JSON.stringify(evidence, null, 2));
  console.log(
    `Ground truth, two rasterizers and visual evidence verified for ${evidence.length} comparisons.`,
  );
} finally {
  await browser.close();
}
