import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { svgPoints } from "./stage12-svg-metrics.mjs";
import { primitives } from "./shared-edge-metrics.mjs";
import { geometry, chains } from "./curve-geometry-metrics.mjs";
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
// Uniform arclength sampling on a 0.002px flattened curve. A collinear cubic
// and an L command have the same locus; their SVG parameter speeds must not
// change the statistical weight of distant noise regions in p95/Chamfer.
function pointChains(svg) {
  return chains(geometry(svg)).map((ps) => {
    const lengths = [0];
    for (let i = 1; i < ps.length; i++)
      lengths.push(lengths.at(-1) + d(ps[i - 1], ps[i]));
    const total = lengths.at(-1),
      n = Math.max(1, Math.ceil(total * 2));
    if (n > 16384) throw Error("Geometry metric sampling budget");
    let j = 0;
    return Array.from({ length: n + 1 }, (_, i) => {
      const s = (total * i) / n;
      while (j + 1 < lengths.length - 1 && lengths[j + 1] < s) j++;
      const span = lengths[j + 1] - lengths[j],
        t = span ? (s - lengths[j]) / span : 0;
      return [
        ps[j][0] + (ps[j + 1][0] - ps[j][0]) * t,
        ps[j][1] + (ps[j + 1][1] - ps[j][1]) * t,
      ];
    });
  });
}
function points(svg) {
  return pointChains(svg).flat();
}
const inRoi = (p) => p[0] > 2 && p[0] < 126 && p[1] > 2 && p[1] < 126;
function segments(chains) {
  return chains.flatMap((ps) =>
    ps
      .slice(1)
      .map((b, i) => [ps[i], b])
      .filter((e) => e.every(inRoi)),
  );
}
function nearestSegment(p, lines) {
  let best = Infinity;
  for (const [a, b] of lines) {
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      norm = dx * dx + dy * dy;
    const t = norm
      ? Math.max(
          0,
          Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / norm),
        )
      : 0;
    const x = p[0] - a[0] - t * dx,
      y = p[1] - a[1] - t * dy;
    best = Math.min(best, x * x + y * y);
  }
  return Math.sqrt(best);
}
function outputCorners(svg) {
  const out = [];
  for (const { edges } of primitives(svg))
    for (const next of edges) {
      const q = next[0];
      if (q[0] <= 2 || q[0] >= 126 || q[1] <= 2 || q[1] >= 126) continue;
      const prev = edges.find((e) => d(e.at(-1), q) < 1e-5);
      if (!prev) continue;
      const before = prev.length === 4 ? prev[2] : prev[0],
        after = next[1];
      const a = [q[0] - before[0], q[1] - before[1]],
        b = [after[0] - q[0], after[1] - q[1]];
      const norm = Math.hypot(...a) * Math.hypot(...b);
      if (
        norm > 1e-8 &&
        Math.acos(
          Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1]) / norm)),
        ) > 0.65 &&
        !out.some((p) => d(p, q) < 1e-4)
      )
        out.push(q);
    }
  return out;
}
function cornerAccuracy(candidates, expected) {
  const available = new Set(candidates.map((_, i) => i));
  const errors = [];
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
      errors.push(delta);
      available.delete(best);
    }
  }
  return {
    precision: candidates.length
      ? errors.length / candidates.length
      : expected.length
        ? 0
        : 1,
    recall: expected.length ? errors.length / expected.length : 1,
    matched: errors.length,
    cornerCount: candidates.length,
    meanPositionError: errors.length
      ? errors.reduce((a, b) => a + b, 0) / errors.length
      : null,
  };
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
    const referenceChains = await page.evaluate((svg) => {
      const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
      const root = document.importNode(doc.documentElement, true);
      document.body.append(root);
      const out = Array.from(root.querySelectorAll("path,circle,ellipse,rect"))
        .slice(1)
        .map((el) => {
          const g = el;
          const len = g.getTotalLength();
          return Array.from(
            { length: Math.min(1024, Math.max(64, Math.ceil(len * 2))) + 1 },
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
    const referenceLines = segments(referenceChains);
    const reference = referenceChains
      .flat()
      .filter((p) => p[0] > 2 && p[0] < 126 && p[1] > 2 && p[1] < 126);
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
      const outputLines = segments(pointChains(svg));
      const errors = samples.map((p) => nearestSegment(p, referenceLines));
      const reverse = reference.map((p) => nearestSegment(p, outputLines));
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
      if (expected)
        v.geometry.outputCorners = cornerAccuracy(outputCorners(svg), expected);
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
    const oldAuto = row.variants.find((v) => v.profile === "pre-source"),
      newAuto = row.variants.find((v) => v.profile === "auto");
    if (
      oldAuto.geometry.outputCorners &&
      ["square", "triangle", "star", "mixed"].some((k) =>
        row.name.includes(k + "-128"),
      )
    ) {
      assert(
        newAuto.geometry.outputCorners.recall >=
          oldAuto.geometry.outputCorners.recall,
        `${row.name}: protected corner recall regressed`,
      );
      assert(
        newAuto.geometry.outputCorners.precision >=
          oldAuto.geometry.outputCorners.precision,
        `${row.name}: false corner regression`,
      );
    }
    for (const scale of process.argv.includes("--metrics-only")
      ? []
      : [1, 4, 10]) {
      await page.setViewportSize({
        width: 128 * scale * images.length + 48,
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
