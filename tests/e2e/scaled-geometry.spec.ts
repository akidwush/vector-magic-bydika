import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { primitives } from "../../scripts/shared-edge-metrics.mjs";

test("true corners and circular shape survive low and high resolution", async ({
  page,
}, info) => {
  test.setTimeout(180000);
  await page.goto("./");
  const rows = [];
  for (const size of [64, 256, 512])
    for (const kind of ["triangle", "star", "circle"]) {
      const svg = await readFile(
        kind === "circle"
          ? "tests/fixtures/coverage/circle.svg"
          : `tests/fixtures/corners/${kind}.svg`,
        "utf8",
      );
      const source = await sharp(Buffer.from(svg), {
        density: (72 * size) / 128,
      })
        .png()
        .toBuffer();
      await page
        .getByLabel("Pilih gambar", { exact: true })
        .setInputFiles({
          name: `${kind}-${size}.png`,
          mimeType: "image/png",
          buffer: source,
        });
      const variants = [];
      for (const profile of ["pre-source", "auto"]) {
        await page.getByLabel("Profil kontur").selectOption(profile);
        await page.getByRole("button", { name: "Konversi ke SVG" }).click();
        await expect(
          page.getByRole("link", { name: "Download SVG" }),
        ).toBeVisible();
        const pending = page.waitForEvent("download");
        await page.getByRole("link", { name: "Download SVG" }).click();
        const out = await readFile((await (await pending).path())!, "utf8");
        const perf = JSON.parse(
          (await page.locator(".result").getAttribute("data-metrics"))!,
        );
        const shapes = primitives(out);
        const corners: number[][] = [];
        let radial = 0,
          n = 0;
        for (const { edges } of shapes)
          for (const edge of edges) {
            const q = edge[0];
            if (q[0] <= 1 || q[1] <= 1 || q[0] >= size - 1 || q[1] >= size - 1)
              continue;
            const prev = edges.find(
              (e) =>
                Math.hypot(e.at(-1)![0] - q[0], e.at(-1)![1] - q[1]) < 1e-5,
            );
            if (!prev) continue;
            const before = prev.length === 4 ? prev[2] : prev[0],
              after = edge[1];
            const a = [q[0] - before[0], q[1] - before[1]],
              b = [after[0] - q[0], after[1] - q[1]];
            const norm = Math.hypot(...a) * Math.hypot(...b);
            if (
              norm > 1e-8 &&
              Math.acos(
                Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1]) / norm)),
              ) > 0.65 &&
              !corners.some((p) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-4)
            )
              corners.push(q);
            if (kind === "circle")
              for (let i = 0; i <= 64; i++) {
                const t = i / 64,
                  u = 1 - t;
                const p =
                  edge.length === 4
                    ? [0, 1].map(
                        (k) =>
                          u * u * u * edge[0][k] +
                          3 * u * u * t * edge[1][k] +
                          3 * u * t * t * edge[2][k] +
                          t * t * t * edge[3][k],
                      )
                    : [
                        q[0] * u + edge.at(-1)![0] * t,
                        q[1] * u + edge.at(-1)![1] * t,
                      ];
                const e =
                  Math.hypot(
                    p[0] - (63.35 * size) / 128,
                    p[1] - (64.2 * size) / 128,
                  ) -
                  (35.7 * size) / 128;
                radial += e * e;
                n++;
              }
          }
        const reference =
          kind === "triangle"
            ? [
                [64, 12],
                [116, 110],
                [12, 110],
              ]
            : kind === "star"
              ? [
                  [64, 10],
                  [76, 46],
                  [114, 46],
                  [84, 69],
                  [96, 108],
                  [64, 84],
                  [32, 108],
                  [44, 69],
                  [14, 46],
                  [52, 46],
                ]
              : [];
        const hits = reference.filter((p) =>
          corners.some(
            (q) =>
              Math.hypot(
                q[0] - (p[0] * size) / 128,
                q[1] - (p[1] * size) / 128,
              ) <= 2,
          ),
        ).length;
        variants.push({
          profile,
          perf,
          corners: corners.length,
          hits,
          radialRms: n ? Math.sqrt(radial / n) : undefined,
        });
        await writeFile(info.outputPath(`${kind}-${size}-${profile}.svg`), out);
      }
      const [old, current] = variants;
      if (kind === "circle")
        expect(current.radialRms!).toBeLessThanOrEqual(old.radialRms! + 0.02);
      else {
        expect(current.hits).toBeGreaterThanOrEqual(old.hits);
        expect(current.hits).toBe(kind === "star" ? 10 : 3);
      }
      rows.push({ kind, size, variants });
    }
  await mkdir("benchmark-results/source-quality", { recursive: true });
  await writeFile(
    "benchmark-results/source-quality/scaled.json",
    JSON.stringify(rows, null, 2),
  );
});
