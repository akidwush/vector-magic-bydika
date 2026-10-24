import { test, expect } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
const fixtures = [
  "icon.png",
  "corners.png",
  "curves.png",
  "illustration.png",
  "lineart.png",
  "gradient.jpg",
  "transparent.png",
  "illustration.webp",
];
test("real WASM traces fixtures, exports editable SVG, and records baseline", async ({
  page,
  browser,
}, testInfo) => {
  const errors: string[] = [],
    network: string[] = [];
  let wasm = false;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (r) => {
    if (
      r.url().startsWith("http") &&
      !r.url().startsWith("http://127.0.0.1:4173")
    )
      network.push(r.url());
  });
  page.on("response", (r) => {
    if (r.url().endsWith(".wasm") && r.ok()) wasm = true;
  });
  await page.goto("./");
  const rows = [];
  for (const name of fixtures) {
    await page
      .getByLabel("Pilih gambar", { exact: true })
      .setInputFiles(`tests/fixtures/${name}`);
    for (const preset of ["logo", "illustration", "photo"]) {
      await page.locator(`input[value="${preset}"]`).check();
      await page.getByRole("button", { name: "Konversi ke SVG" }).click();
      await expect(
        page.getByRole("link", { name: "Download SVG" }),
      ).toBeVisible();
      const result = await page.locator(".result").innerText();
      expect(result).toContain("vtracer-wasm");
      const downloadEvent = page.waitForEvent("download");
      await page.getByRole("link", { name: "Download SVG" }).click();
      const download = await downloadEvent;
      expect(download.suggestedFilename()).toMatch(/\.svg$/);
      const svg = await readFile((await download.path())!, "utf8");
      expect(svg).toContain("<path");
      expect(svg).not.toContain("<image");
      const original = await sharp(`tests/fixtures/${name}`)
        .ensureAlpha()
        .raw()
        .toBuffer();
      const rendered = await sharp(Buffer.from(svg))
        .ensureAlpha()
        .raw()
        .toBuffer();
      expect(rendered.length).toBe(original.length);
      let delta = 0;
      for (let i = 0; i < rendered.length; i++) {
        // Compare premultiplied RGB + alpha, avoiding meaningless hidden colors.
        const channel = i % 4;
        const a =
          channel === 3
            ? original[i]
            : (original[i] * original[i - channel + 3]) / 255;
        const b =
          channel === 3
            ? rendered[i]
            : (rendered[i] * rendered[i - channel + 3]) / 255;
        delta += Math.abs(a - b);
      }
      const mae = delta / rendered.length;
      expect(Number.isFinite(mae)).toBe(true);
      const thresholds: Record<string, number> = {
        "icon.png": 5,
        "corners.png": 6,
        "curves.png": 6,
        "illustration.png": 6,
        "lineart.png": 8,
        "gradient.jpg": 35,
        "transparent.png": 1,
        "illustration.webp": 7,
      };
      expect(mae).toBeLessThan(thresholds[name]);
      await writeFile(testInfo.outputPath(`${name}-${preset}.svg`), svg);
      await page.screenshot({
        path: testInfo.outputPath(`${name}-${preset}.png`),
        fullPage: true,
      });
      const source = await sharp(`tests/fixtures/${name}`).metadata();
      rows.push({
        fixture: name,
        preset,
        browser: browser.version(),
        result,
        svgBytes: Buffer.byteLength(svg),
        sourceBytes: (await readFile(`tests/fixtures/${name}`)).length,
        width: source.width,
        height: source.height,
        premultipliedRgbaMAE: mae,
      });
    }
  }
  expect(wasm).toBe(true);
  expect(errors).toEqual([]);
  expect(network).toEqual([]);
  await page.getByRole("button", { name: "Slider", exact: true }).click();
  await page.getByLabel("Batas perbandingan").fill("25");
  await expect(page.locator(".vectoroverlay")).toHaveCSS(
    "clip-path",
    "inset(0px 75% 0px 0px)",
  );
  await page.getByRole("button", { name: "Perbesar", exact: true }).click();
  await expect(page.locator(".zoom")).toContainText("125%");
  await page.screenshot({
    path: testInfo.outputPath("desktop.png"),
    fullPage: true,
  });
  await mkdir("benchmark-results", { recursive: true });
  await writeFile(
    "benchmark-results/baseline.json",
    JSON.stringify(rows, null, 2),
  );
});
test("fallback, failed WASM initialization, reset, mobile and invalid file", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/*.wasm", (route) => route.abort());
  await page.goto("./");
  await page
    .getByLabel("Pilih gambar", { exact: true })
    .setInputFiles("tests/fixtures/illustration.webp");
  await page.getByRole("button", { name: "Konversi ke SVG" }).click();
  await expect(page.locator(".result")).toContainText("imagetracerjs");
  await expect(page.locator(".result")).toContainText(
    "VTracer tidak dapat dimuat",
  );
  const fallbackDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download SVG" }).click();
  const fallbackSvg = await readFile(
    (await (await fallbackDownload).path())!,
    "utf8",
  );
  const fallbackRaster = await sharp(Buffer.from(fallbackSvg))
    .ensureAlpha()
    .raw()
    .toBuffer();
  const originalRaster = await sharp("tests/fixtures/illustration.webp")
    .ensureAlpha()
    .raw()
    .toBuffer();
  let fallbackDelta = 0;
  for (let i = 0; i < fallbackRaster.length; i++)
    fallbackDelta += Math.abs(fallbackRaster[i] - originalRaster[i]);
  expect(fallbackDelta / fallbackRaster.length).toBeLessThan(10);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("mobile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.getByRole("link", { name: "Download SVG" })).toHaveCount(0);
  await page.getByLabel("Pilih gambar", { exact: true }).setInputFiles({
    name: "fake.png",
    mimeType: "image/png",
    buffer: Buffer.from("not an image"),
  });
  await expect(page.getByRole("alert")).toContainText("Format");
});
test("cancel and replacement never publish obsolete output; resources are revoked", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const revoked: string[] = [];
    const original = URL.revokeObjectURL.bind(URL);
    Object.assign(window, { revoked });
    URL.revokeObjectURL = (url: string) => {
      revoked.push(url);
      original(url);
    };
  });
  await page.goto("./");
  await page
    .getByLabel("Pilih gambar", { exact: true })
    .setInputFiles("tests/fixtures/curves.png");
  await page.getByRole("button", { name: "Konversi ke SVG" }).click();
  await page.getByRole("button", { name: "Batalkan", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("dibatalkan");
  await page
    .getByLabel("Pilih gambar", { exact: true })
    .setInputFiles("tests/fixtures/corners.png");
  await page.getByRole("button", { name: "Konversi ke SVG" }).click();
  await expect(
    page.getByRole("link", { name: "Download SVG" }),
  ).toHaveAttribute("download", "corners-nexora.svg");
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  expect(
    await page.evaluate(() => Reflect.get(window, "revoked").length),
  ).toBeGreaterThanOrEqual(3);
});
test("decode guardrails, downscale consent, alpha and forced fallback", async ({
  page,
}) => {
  await page.goto("./");
  const large = await sharp({
    create: { width: 2000, height: 1100, channels: 4, background: "#124531" },
  })
    .png()
    .toBuffer();
  await page
    .getByLabel("Pilih gambar", { exact: true })
    .setInputFiles({ name: "large.png", mimeType: "image/png", buffer: large });
  await expect(
    page.getByRole("button", { name: "Konversi ke SVG" }),
  ).toBeDisabled();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Konversi ke SVG" }).click();
  await expect(page.locator(".result")).toContainText("1906 × 1048");
  const rotated = await sharp({
    create: { width: 64, height: 32, channels: 3, background: "#ea9342" },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  await page
    .getByLabel("Pilih gambar", { exact: true })
    .setInputFiles({
      name: "rotated.jpg",
      mimeType: "image/jpeg",
      buffer: rotated,
    });
  await page.getByRole("button", { name: "Konversi ke SVG" }).click();
  await expect(page.locator(".result")).toContainText("32 × 64");

  await page
    .getByLabel("Pilih gambar", { exact: true })
    .setInputFiles("tests/fixtures/transparent.png");
  await page.locator("summary").click();
  await page.getByLabel("Engine", { exact: true }).selectOption("fallback");
  await page.getByRole("button", { name: "Konversi ke SVG" }).click();
  await expect(page.locator(".result")).toContainText("imagetracerjs");
  // Valid headers with broken compressed pixels must fail during decoding.
  const bytes = await readFile("tests/fixtures/icon.png");
  await page.getByLabel("Pilih gambar", { exact: true }).setInputFiles({
    name: "broken.png",
    mimeType: "image/png",
    buffer: bytes.subarray(0, 33),
  });
  await page.getByRole("button", { name: "Konversi ke SVG" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("link", { name: "Download SVG" })).toHaveCount(0);
});
