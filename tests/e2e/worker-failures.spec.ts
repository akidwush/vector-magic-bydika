import { test, expect, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

async function convertAgain(page: Page, output: string) {
  await page.getByRole("button", { name: "Konversi ke SVG" }).click();
  await expect(page.getByRole("link", { name: "Download SVG" })).toBeVisible();
  await expect(page.locator(".result")).toContainText("vtracer-wasm");
  const ready = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download SVG" }).click();
  const svg = await readFile((await (await ready).path())!, "utf8");
  expect(svg).toContain("<path");
  expect(svg).not.toContain("<image");
  await writeFile(output, svg);
}

for (const failure of ["creation", "transfer", "reply"] as const) {
  test(`recovers from ${failure} failure with a fresh real Worker`, async ({
    page,
  }, info) => {
    // Controlled transport fault; retry must use actual browser WASM and download.
    await page.addInitScript((fault) => {
      const NativeWorker = window.Worker;
      const state = { injected: false, created: 0, terminated: 0 };
      Object.defineProperty(window, "__workerFault", { value: state });
      window.Worker = class extends NativeWorker {
        constructor(url: string | URL, options?: WorkerOptions) {
          if (fault === "creation" && !state.injected) {
            state.injected = true;
            throw new DOMException("Worker creation blocked", "SecurityError");
          }
          super(url, options);
          state.created++;
        }
        override postMessage(
          message: unknown,
          options: Transferable[] | StructuredSerializeOptions = [],
        ) {
          if (!state.injected) {
            state.injected = true;
            if (fault === "transfer")
              throw new DOMException("Transfer failed", "DataCloneError");
            queueMicrotask(() =>
              this.dispatchEvent(new MessageEvent("messageerror")),
            );
            return;
          }
          if (Array.isArray(options)) super.postMessage(message, options);
          else super.postMessage(message, options);
        }
        override terminate() {
          state.terminated++;
          super.terminate();
        }
      };
    }, failure);
    await page.goto("./");
    await page
      .getByLabel("Pilih gambar", { exact: true })
      .setInputFiles("tests/fixtures/icon.png");
    await page.getByRole("button", { name: "Konversi ke SVG" }).click();
    await expect(page.getByRole("alert")).toContainText(
      failure === "creation"
        ? "Worker creation blocked"
        : failure === "transfer"
          ? "Transfer failed"
          : "Balasan Worker tidak dapat dibaca",
    );
    await expect(page.getByRole("link", { name: "Download SVG" })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("button", { name: "Konversi ke SVG" }),
    ).toBeEnabled();
    await page.screenshot({
      path: info.outputPath("handled-error.png"),
      fullPage: true,
    });
    await convertAgain(page, info.outputPath("recovered.svg"));
    const state = await page.evaluate(
      () =>
        Reflect.get(window, "__workerFault") as {
          created: number;
          terminated: number;
        },
    );
    expect(state).toMatchObject(
      failure === "creation"
        ? { created: 1, terminated: 0 }
        : { created: 2, terminated: 1 },
    );
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    expect(
      await page.evaluate(
        () => Reflect.get(window, "__workerFault").terminated,
      ),
    ).toBe(state.created);
  });
}

test("frees decode resources after Canvas readback fails and retries real WASM", async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    const read = CanvasRenderingContext2D.prototype.getImageData;
    const close = ImageBitmap.prototype.close;
    const state = { canvas: null as HTMLCanvasElement | null, closed: 0 };
    Object.defineProperty(window, "__decodeFault", { value: state });
    ImageBitmap.prototype.close = function () {
      state.closed++;
      close.call(this);
    };
    CanvasRenderingContext2D.prototype.getImageData = function (...args) {
      if (!state.canvas) {
        state.canvas = this.canvas;
        throw new DOMException("Canvas readback failed", "InvalidStateError");
      }
      return read.apply(this, args);
    };
  });
  await page.goto("./");
  await page
    .getByLabel("Pilih gambar", { exact: true })
    .setInputFiles("tests/fixtures/icon.png");
  await page.getByRole("button", { name: "Konversi ke SVG" }).click();
  await expect(page.getByRole("alert")).toContainText("Canvas readback failed");
  expect(
    await page.evaluate(() => {
      const s = Reflect.get(window, "__decodeFault") as {
        canvas: HTMLCanvasElement;
        closed: number;
      };
      return {
        width: s.canvas.width,
        height: s.canvas.height,
        closed: s.closed,
      };
    }),
  ).toEqual({ width: 0, height: 0, closed: 1 });
  await convertAgain(page, info.outputPath("recovered.svg"));
});
