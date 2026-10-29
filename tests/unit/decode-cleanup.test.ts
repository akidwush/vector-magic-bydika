import { afterEach, expect, it, vi } from "vitest";
import { decode } from "../../src/lib/input";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const file = () => {
  const b = new Uint8Array(24);
  b.set([137, 80, 78, 71, 13, 10, 26, 10]);
  b.set([73, 72, 68, 82], 12);
  const v = new DataView(b.buffer);
  v.setUint32(16, 2);
  v.setUint32(20, 2);
  return {
    size: b.length,
    type: "image/png",
    arrayBuffer: async () => b.buffer,
  } as File;
};

it.each(["drawImage", "getImageData", "context"])(
  "releases canvas and bitmap when %s fails during decode",
  async (stage) => {
    const close = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ width: 2, height: 2, close }),
    );
    const canvases: HTMLCanvasElement[] = [];
    const ctx = {
      drawImage: vi.fn(),
      getImageData: vi
        .fn()
        .mockReturnValue({ data: new Uint8ClampedArray(16) }),
    };
    if (stage !== "context")
      ctx[stage as "drawImage" | "getImageData"].mockImplementation(() => {
        throw new Error("Canvas failure");
      });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      function (this: HTMLCanvasElement) {
        canvases.push(this);
        return stage === "context"
          ? null
          : (ctx as unknown as CanvasRenderingContext2D);
      },
    );
    await expect(decode(file(), false)).rejects.toThrow(
      stage === "context" ? "Canvas tidak tersedia" : "Canvas failure",
    );
    expect(close).toHaveBeenCalledOnce();
    expect(canvases[0]?.width).toBe(0);
    expect(canvases[0]?.height).toBe(0);
  },
);
