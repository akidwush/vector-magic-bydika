// Independent final-byte local/context reconstruction, outside the Rust solver.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { chromium } from "@playwright/test";
const root = process.env.NEXORA_ART_ROOT,
  fixtures = process.env.NEXORA_ART_FIXTURES ?? "tests/fixtures/real-artwork",
  out = process.env.NEXORA_WATERSHED_PAINT_ROOT ?? root + "/final-paint-proof";
await mkdir(out);
const rows = (await readFile(root + "/conversions.jsonl", "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse),
  corpus = JSON.parse(await readFile(fixtures + "/manifest.json")),
  hash = (b) => createHash("sha256").update(b).digest("hex"),
  records = [],
  issues = [];
const browser = await chromium.launch({
    executablePath: process.env.NEXORA_CHROMIUM_PATH,
  }),
  page = await browser.newPage();
async function chrome(svg, w, h) {
  return Buffer.from(
    await page.evaluate(
      async ({ svg, w, h }) => {
        const i = new Image();
        i.src =
          "data:image/svg+xml;base64," +
          btoa(unescape(encodeURIComponent(svg)));
        await i.decode();
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        c.getContext("2d").drawImage(i, 0, 0, w, h);
        return Array.from(c.getContext("2d").getImageData(0, 0, w, h).data);
      },
      { svg, w, h },
    ),
  );
}
try {
  for (const c of rows.filter((r) => r.config.id === "combined")) {
    const b = rows.find((r) => r.image === c.image && r.config.id === "A-auto");
    if (!b || b.status !== "EXPORTED" || c.status !== "EXPORTED") {
      issues.push(c.image + ": incomplete conversion");
      continue;
    }
    if (b.runs[0].svgSHA256 === c.runs[0].svgSHA256) continue;
    const item = corpus.images.find((r) => r.id === c.image),
      file = await readFile(fixtures + "/" + item.image),
      source = await sharp(file).ensureAlpha().raw().toBuffer(),
      bs = await readFile(root + "/" + b.runs[0].export),
      cs = await readFile(root + "/" + c.runs[0].export);
    if (
      hash(file) !== item.imageSHA256 ||
      hash(bs) !== b.runs[0].svgSHA256 ||
      hash(cs) !== c.runs[0].svgSHA256
    )
      throw Error("hash mismatch");
    for (const renderer of ["libvips", "chromium"]) {
      const render = async (s) =>
          renderer === "libvips"
            ? sharp(s).ensureAlpha().raw().toBuffer()
            : chrome(s.toString(), item.width, item.height),
        a = await render(bs),
        z = await render(cs),
        w = item.width,
        h = item.height,
        tiles = [];
      let bad = 0,
        badContext = 0;
      const box = [w, h, 0, 0];
      const score = ([x, y, bw, bh]) => {
        let old = 0,
          now = 0;
        for (let yy = y; yy < y + bh; yy++)
          for (let xx = x; xx < x + bw; xx++) {
            const i = (yy * w + xx) * 4;
            for (let k = 0; k < 4; k++) {
              const s =
                  k === 3
                    ? source[i + k]
                    : (source[i + k] * source[i + 3]) / 255,
                o = k === 3 ? a[i + k] : (a[i + k] * a[i + 3]) / 255,
                n = k === 3 ? z[i + k] : (z[i + k] * z[i + 3]) / 255;
              old += Math.abs(o - s);
              now += Math.abs(n - s);
            }
          }
        return { before: old / (bw * bh * 4), after: now / (bw * bh * 4) };
      };
      for (let y = 0; y < h; y += 8)
        for (let x = 0; x < w; x += 8) {
          const tile = [x, y, Math.min(8, w - x), Math.min(8, h - y)];
          let changed = false;
          for (let yy = y; yy < y + tile[3]; yy++)
            for (let xx = x; xx < x + tile[2]; xx++) {
              const i = (yy * w + xx) * 4;
              if ([0, 1, 2, 3].some((k) => a[i + k] !== z[i + k])) {
                changed = true;
                box[0] = Math.min(box[0], xx);
                box[1] = Math.min(box[1], yy);
                box[2] = Math.max(box[2], xx);
                box[3] = Math.max(box[3], yy);
              }
            }
          if (!changed) continue;
          const local = score(tile),
            context = [
              Math.max(0, x - 2),
              Math.max(0, y - 2),
              Math.min(w, x + tile[2] + 2) - Math.max(0, x - 2),
              Math.min(h, y + tile[3] + 2) - Math.max(0, y - 2),
            ],
            around = score(context);
          if (local.after > local.before + 1e-9) bad++;
          if (around.after > around.before + 1e-9) badContext++;
          tiles.push({ tile, local, context, around });
        }
      if (bad || badContext || !tiles.length)
        issues.push(c.image + ": " + renderer + " local/context failure");
      const bbox = tiles.length
        ? [box[0], box[1], box[2] - box[0] + 1, box[3] - box[1] + 1]
        : null;
      records.push({
        image: c.image,
        renderer,
        changedPixelBBox: bbox,
        changedTiles: tiles.length,
        worseTiles: bad,
        worseContextTiles: badContext,
        tiles,
      });
      for (const [name, data] of [
        ["baseline", a],
        ["candidate", z],
        ["source", source],
      ])
        await sharp(data, { raw: { width: w, height: h, channels: 4 } })
          .png()
          .toFile(out + "/" + c.image + "-" + renderer + "-" + name + ".png");
    }
  }
  const result = {
    status: issues.length ? "FAIL" : "PASS",
    records,
    issues,
    scriptSHA256: hash(await readFile(new URL(import.meta.url))),
    policy:
      "Actual downloaded SVG bytes, two independent renderers, source-only premultiplied RGBA; every changed8x8 tile plus2px context checked. Identical exports skipped by verified hashes, not assumed repaired.",
  };
  await writeFile(out + "/proof.json", JSON.stringify(result, null, 2));
  console.log({
    status: result.status,
    records: records.map(
      ({
        image,
        renderer,
        changedPixelBBox,
        changedTiles,
        worseTiles,
        worseContextTiles,
      }) => ({
        image,
        renderer,
        changedPixelBBox,
        changedTiles,
        worseTiles,
        worseContextTiles,
      }),
    ),
    issues,
  });
  if (issues.length) process.exitCode = 1;
} finally {
  await browser.close();
}
