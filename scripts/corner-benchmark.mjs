import { chromium } from "@playwright/test";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { svgPoints } from "./stage12-svg-metrics.mjs";
import { primitives } from "./shared-edge-metrics.mjs";
const root = "benchmark-results/stage13";
const rows = JSON.parse(await readFile(root + "/production.json"));
const truth = JSON.parse(await readFile("tests/fixtures/corners/truth.json"));
const folder = (await readdir("test-results")).find((n) =>
  n.startsWith("corners-corner-fitting"),
);
const browser = await chromium.launch({
  executablePath: process.env.NEXORA_CHROMIUM_PATH,
});
const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const nearest = (a, bs) => bs.reduce((m, b) => Math.min(m, d(a, b)), Infinity);
function points(svg) {
  return primitives(svg)
    .flatMap((p) => p.edges)
    .filter(
      (ps) =>
        !ps.every((p) => p[0] === 0) &&
        !ps.every((p) => p[0] === 128) &&
        !ps.every((p) => p[1] === 0) &&
        !ps.every((p) => p[1] === 128),
    )
    .flatMap((ps) =>
      Array.from(
        {
          length: Math.min(
            65,
            Math.max(
              2,
              Math.ceil(
                ps.slice(1).reduce((s, p, i) => s + d(p, ps[i]), 0) * 2,
              ) + 1,
            ),
          ),
        },
        (_, i) => {
          const n = Math.min(
            64,
            Math.max(
              1,
              Math.ceil(
                ps.slice(1).reduce((s, p, i) => s + d(p, ps[i]), 0) * 2,
              ),
            ),
          );
          const t = i / n,
            u = 1 - t;
          return ps.length === 2
            ? [ps[0][0] * u + ps[1][0] * t, ps[0][1] * u + ps[1][1] * t]
            : [0, 1].map(
                (k) =>
                  u * u * u * ps[0][k] +
                  3 * u * u * t * ps[1][k] +
                  3 * u * t * t * ps[2][k] +
                  t * t * t * ps[3][k],
              );
        },
      ),
    );
}
try {
  const page = await browser.newPage();
  for (const row of rows) {
    const input = row.name.startsWith("../")
      ? "tests/fixtures/" + row.name.slice(3)
      : "tests/fixtures/shared-edge/" + row.name;
    const vector = input
      .replace(/-128\.png$/, ".svg")
      .replace(/\.(png|jpg|webp)$/, ".svg");
    const gt = await readFile(vector, "utf8");
    const referenceAll = await page.evaluate((svg) => {
      const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
      const root = document.importNode(doc.documentElement, true);
      document.body.append(root);
      const out = Array.from(root.querySelectorAll("path,circle,ellipse,rect"))
        .slice(1)
        .flatMap((el) => {
          const g = el;
          const len = g.getTotalLength();
          return Array.from(
            { length: Math.min(1024, Math.max(64, Math.ceil(len * 2))) },
            (_, i) => {
              const p = g.getPointAtLength(
                (i / Math.min(1024, Math.max(64, Math.ceil(len * 2)))) * len,
              );
              return [p.x, p.y];
            },
          );
        });
      root.remove();
      return out;
    }, gt);
    const reference = referenceAll.filter(
      (p) => p[0] > 2 && p[0] < 126 && p[1] > 2 && p[1] < 126,
    );
    const images = [
      [
        "Original",
        await readFile(input),
        input.endsWith(".jpg")
          ? "image/jpeg"
          : input.endsWith(".webp")
            ? "image/webp"
            : "image/png",
      ],
    ];
    for (const v of row.variants) {
      const svg = await readFile(
        `test-results/${folder}/${row.name.replaceAll("/", "-")}-${v.profile}.svg`,
        "utf8",
      );
      const samples = points(svg).filter(
        (p) => p[0] > 2 && p[0] < 126 && p[1] > 2 && p[1] < 126,
      );
      const errors = samples.map((p) => nearest(p, reference));
      const reverse = reference.map((p) => nearest(p, samples));
      const all = [...errors, ...reverse].sort((a, b) => a - b);
      v.geometry = {
        svgNodes: svgPoints(svg),
        chamfer:
          (errors.reduce((a, b) => a + b, 0) / errors.length +
            reverse.reduce((a, b) => a + b, 0) / reverse.length) /
          2,
        hausdorff95: all[Math.floor(all.length * 0.95)],
        bytes: Buffer.byteLength(svg),
      };
      if (row.name.startsWith("../coverage/")) {
        const el = gt.match(/<(circle|ellipse)\b[^>]*>/)?.[0];
        if (el) {
          const attr = (k) =>
            Number(el.match(new RegExp(k + '="([^\"]+)"'))?.[1]);
          const cx = attr("cx"),
            cy = attr("cy"),
            rx = attr("rx") || attr("r"),
            ry = attr("ry") || attr("r");
          const radial = samples.map(
            (q) =>
              (Math.hypot((q[0] - cx) / rx, (q[1] - cy) / ry) - 1) *
              Math.sqrt(rx * ry),
          );
          const xs = samples.map((q) => q[0]),
            ys = samples.map((q) => q[1]);
          const min = (a) => a.reduce((m, x) => Math.min(m, x), Infinity),
            max = (a) => a.reduce((m, x) => Math.max(m, x), -Infinity);
          v.geometry.ellipse = {
            centerError: Math.hypot(
              (min(xs) + max(xs)) / 2 - cx,
              (min(ys) + max(ys)) / 2 - cy,
            ),
            radialRms: Math.sqrt(
              radial.reduce((s, x) => s + x * x, 0) / radial.length,
            ),
            radiusXError: Math.abs((max(xs) - min(xs)) / 2 - rx),
            radiusYError: Math.abs((max(ys) - min(ys)) / 2 - ry),
          };
        }
      }
      const key = row.name
        .split("/")
        .at(-1)
        .replace(/-128\.png$|\.jpg$|\.webp$/, "");
      const expected = truth[key]?.corners;
      if (expected && v.profile === "intelligent") {
        const records = v.perf.corners || [];
        const candidates = [];
        for (let i = 0; i < records.length; i += 7)
          if (
            records[i + 6] &&
            records[i + 4] > 1 &&
            records[i + 4] < 127 &&
            records[i + 5] > 1 &&
            records[i + 5] < 127
          )
            candidates.push([records[i + 4], records[i + 5]]);
        const available = new Set(candidates.map((_, i) => i));
        let hits = 0;
        for (const p of expected) {
          let best = -1,
            delta = 2;
          for (const i of available) {
            const dd = d(p, candidates[i]);
            if (dd <= delta) {
              best = i;
              delta = dd;
            }
          }
          if (best >= 0) {
            hits++;
            available.delete(best);
          }
        }
        v.geometry.corners = {
          precision: candidates.length ? hits / candidates.length : 0,
          recall: hits / expected.length,
          meanPositionError: candidates.length
            ? expected.reduce((s, p) => s + nearest(p, candidates), 0) /
              expected.length
            : null,
          candidateCount: candidates.length,
        };
      }
      images.push([v.profile, Buffer.from(svg), "image/svg+xml"]);
    }
    for (const scale of process.argv.includes("--metrics-only")
      ? []
      : [1, 4, 10]) {
      await page.setViewportSize({
        width: 128 * scale * 3 + 48,
        height: 128 * scale + 100,
      });
      await page.setContent(
        `<body style="background:#ccc;font:16px sans-serif"><h2>${row.name} ${scale * 100}%</h2><div style="display:flex;gap:8px">${images.map(([label, data, type]) => `<figure style="margin:0"><figcaption>${label}</figcaption><img width="${128 * scale}" height="${128 * scale}" src="data:${type};base64,${data.toString("base64")}"></figure>`).join("")}</div></body>`,
      );
      await page
        .locator("img")
        .evaluateAll((imgs) => Promise.all(imgs.map((i) => i.decode())));
      await page.screenshot({
        path: `${root}/${row.name.replaceAll("/", "-")}-${scale * 100}.png`,
        fullPage: true,
      });
    }
  }
  await writeFile(root + "/geometry.json", JSON.stringify(rows, null, 2));
} finally {
  await browser.close();
}
