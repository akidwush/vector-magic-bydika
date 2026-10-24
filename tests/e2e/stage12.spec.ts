import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { geometryMetrics } from "../../scripts/stage12-metrics.mjs";
test("production profiles improve eyes and blended boundaries; worker stays warm", async ({
  page,
}, info) => {
  await page.goto("./");
  const rows = [];
  for (const name of [
    "quality/cat-128-opaque.png",
    "stage12/cat-128-blended.png",
    "stage12/cat-128-lossy.jpg",
    "stage12/cat-128-lossy.webp",
    "stage12/openmoji-cat-128.png",
  ]) {
    const source = await sharp(`tests/fixtures/${name}`)
      .ensureAlpha()
      .raw()
      .toBuffer();
    const gt = name.includes("openmoji")
      ? source
      : await sharp("tests/fixtures/quality/cat-128-opaque.png")
          .ensureAlpha()
          .raw()
          .toBuffer();
    await page
      .getByLabel("Pilih gambar", { exact: true })
      .setInputFiles(`tests/fixtures/${name}`);
    const variants = [];
    for (const profile of ["legacy", "auto"]) {
      await page.getByLabel("Profil kontur").selectOption(profile);
      await page.getByRole("button", { name: "Konversi ke SVG" }).click();
      await expect(
        page.getByRole("link", { name: "Download SVG" }),
      ).toBeVisible();
      const perf = JSON.parse(
        (await page.locator(".result").getAttribute("data-metrics"))!,
      );
      const pending = page.waitForEvent("download");
      await page.getByRole("link", { name: "Download SVG" }).click();
      const svg = await readFile((await (await pending).path())!, "utf8");
      expect(svg).not.toContain("<image");
      expect(svg).not.toContain("stroke-width");
      const raw = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer();
      const measured = geometryMetrics(
        gt,
        raw,
        128,
        128,
        !name.includes("openmoji"),
      );
      variants.push({ profile, perf, ...measured });
      await writeFile(
        info.outputPath(`${name.replaceAll("/", "-")}-${profile}.svg`),
        svg,
      );
      await page.screenshot({
        path: info.outputPath(`${name.replaceAll("/", "-")}-${profile}.png`),
        fullPage: true,
      });
    }
    const [base, actual] = variants;
    expect(actual.perf.warm).toBe(true);
    expect(actual.perf.startupMs).toBeLessThan(50);
    if (name === "quality/cat-128-opaque.png") {
      expect(actual.eyeIoU![0]).toBeGreaterThan(base.eyeIoU![0] + 0.02);
      expect(actual.eyeRadialCV![0]).toBeLessThan(base.eyeRadialCV![0]);
    }
    if (name.includes("blended")) {
      expect(actual.boundaryF1).toBeGreaterThan(base.boundaryF1 + 0.08);
      expect(actual.symmetricContourDistance).toBeLessThan(
        base.symmetricContourDistance,
      );
      expect(actual.perf.profile).toBe("blend");
      expect(Math.min(...actual.eyeIoU!)).toBeGreaterThan(0.9);
    }
    if (name.includes("openmoji"))
      await expect(page.locator(".result")).toContainText("BELUM DIDUKUNG");
    if (name.includes("openmoji")) {
      await page.getByLabel("Profil kontur").selectOption("shared");
      await page.getByRole("button", { name: "Konversi ke SVG" }).click();
      await expect(
        page.getByRole("link", { name: "Download SVG" }),
      ).toBeVisible();
      const sharedDownload = page.waitForEvent("download");
      await page.getByRole("link", { name: "Download SVG" }).click();
      const sharedSvg = await readFile(
        (await (await sharedDownload).path())!,
        "utf8",
      );
      const sharedPixels = await sharp(Buffer.from(sharedSvg))
        .ensureAlpha()
        .raw()
        .toBuffer();
      const sharedMetrics = geometryMetrics(gt, sharedPixels, 128, 128, false);
      expect(sharedMetrics.boundaryF1).toBeGreaterThan(base.boundaryF1 + 0.15);
      await expect(page.locator(".result")).toContainText("BELUM DIDUKUNG");
      await writeFile(info.outputPath("licensed-art-shared.svg"), sharedSvg);
      variants.push({
        profile: "shared",
        perf: JSON.parse(
          (await page.locator(".result").getAttribute("data-metrics"))!,
        ),
        ...sharedMetrics,
      });
      await page.getByLabel("Profil kontur").selectOption("auto");
    }
    rows.push({ name, variants });
  }
  await page
    .getByLabel("Pilih gambar", { exact: true })
    .setInputFiles("tests/fixtures/quality/cat-128-opaque.png");
  await page.locator('input[value="logo"]').check();
  await page.getByRole("button", { name: "Konversi ke SVG" }).click();
  await expect(page.getByRole("link", { name: "Download SVG" })).toBeVisible();
  const logoDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download SVG" }).click();
  const logoSvg = await readFile((await (await logoDownload).path())!, "utf8");
  const logoGt = await sharp("tests/fixtures/quality/cat-128-opaque.png")
    .ensureAlpha()
    .raw()
    .toBuffer();
  const logoPixels = await sharp(Buffer.from(logoSvg))
    .ensureAlpha()
    .raw()
    .toBuffer();
  const logo = geometryMetrics(logoGt, logoPixels, 128, 128, true);
  expect(logo.eyeIoU![0]).toBeGreaterThan(0.9);
  expect(logo.muzzleIoU!).toBeGreaterThan(0.97);
  await mkdir("benchmark-results/stage12", { recursive: true });
  await writeFile(
    "benchmark-results/stage12/production.json",
    JSON.stringify(rows, null, 2),
  );
});

test("same-profile cold/warm evidence and reset discards the cached worker", async ({
  page,
}) => {
  await page.goto("./");
  const observations = [];
  let wasmRequests = 0;
  page.on("request", (r) => {
    if (r.url().endsWith(".wasm")) wasmRequests++;
  });
  await page
    .getByLabel("Pilih gambar", { exact: true })
    .setInputFiles("tests/fixtures/quality/cat-128-opaque.png");
  const svgs = [];
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: "Konversi ke SVG" }).click();
    await expect(
      page.getByRole("link", { name: "Download SVG" }),
    ).toBeVisible();
    observations.push(
      JSON.parse((await page.locator(".result").getAttribute("data-metrics"))!),
    );
    const pending = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download SVG" }).click();
    svgs.push(await readFile((await (await pending).path())!, "utf8"));
  }
  expect(observations[0].warm).toBe(false);
  expect(observations[1].warm).toBe(true);
  expect(wasmRequests).toBe(1);
  expect(svgs[0]).toBe(svgs[1]);
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await page
    .getByLabel("Pilih gambar", { exact: true })
    .setInputFiles("tests/fixtures/quality/cat-128-opaque.png");
  await page.getByRole("button", { name: "Konversi ke SVG" }).click();
  await expect(page.getByRole("link", { name: "Download SVG" })).toBeVisible();
  const reset = JSON.parse(
    (await page.locator(".result").getAttribute("data-metrics"))!,
  );
  expect(reset.warm).toBe(false);
  expect(wasmRequests).toBe(2);
  await mkdir("benchmark-results/stage12", { recursive: true });
  await writeFile(
    "benchmark-results/stage12/cold-warm.json",
    JSON.stringify({ observations, reset }, null, 2),
  );
});
