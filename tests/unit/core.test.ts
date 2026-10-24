import { describe, it, expect, vi, afterEach } from "vitest";
import {
  identify,
  dimensions,
  checkDimensions,
  inspectFile,
  limits,
} from "../../src/lib/input";
import { validateSvg, exportName, svgBlob } from "../../src/lib/svg";
import { presets } from "../../src/engine/types";
import { TraceClient } from "../../src/engine/client";
const valid =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><path d="M0 0L20 10Z"/></svg>';
describe("input guards", () => {
  it("rejects spoofed and unsupported files", () => {
    expect(() => identify(new Uint8Array([1, 2, 3]))).toThrow();
  });
  it("recognizes signatures and validates dimensions before decode", () => {
    const b = new Uint8Array(24);
    b.set([137, 80, 78, 71, 13, 10, 26, 10]);
    b.set([73, 72, 68, 82], 12);
    const v = new DataView(b.buffer);
    v.setUint32(16, 128);
    v.setUint32(20, 64);
    expect(identify(b)).toBe("image/png");
    expect(dimensions(b, "image/png")).toEqual({ width: 128, height: 64 });
    v.setUint32(16, 100000);
    v.setUint32(20, 100000);
    expect(() => dimensions(b, "image/png")).toThrow();
  });
  it("rejects zero, negative and oversized dimensions", () => {
    for (const n of [0, -1, NaN, 1e9])
      expect(() => checkDimensions(n, 128)).toThrow();
  });
  it("rejects size limits before reading", async () => {
    await expect(inspectFile(new File([], "empty.png"))).rejects.toThrow();
    const file = { size: limits.fileBytes + 1 } as File;
    await expect(inspectFile(file)).rejects.toThrow();
  });
  it("rejects MIME/signature mismatch", async () => {
    const b = new Uint8Array(24);
    b.set([137, 80, 78, 71, 13, 10, 26, 10]);
    b.set([73, 72, 68, 82], 12);
    await expect(
      inspectFile({
        size: 24,
        type: "image/jpeg",
        arrayBuffer: async () => b.buffer,
      } as File),
    ).rejects.toThrow("MIME");
  });
});
describe("SVG and export", () => {
  it("preserves real geometry and supplies viewBox", () => {
    const out = validateSvg(valid);
    expect(out.pathCount).toBe(1);
    expect(out.svg).toContain('viewBox="0 0 20 10"');
  });
  it.each([
    "garbage",
    "<svg/>",
    valid.replace('<path d="M0 0L20 10Z"/>', ""),
    valid.replace(
      '<path d="M0 0L20 10Z"/>',
      '<image href="data:image/png;base64,AA"/>',
    ),
    valid.replace("/></svg>", "/><script>alert(1)</script></svg>"),
    valid.replace('d="M0', 'onclick="x()" d="M0'),
    valid.replace('d="M0', 'fill="url(https://x)" d="M0'),
    valid.replace('width="20"', 'width="0"'),
    valid.replace('height="10"', 'height="10" viewBox="0 0 -1 5"'),
  ])("rejects unsafe or empty SVG %s", (svg) =>
    expect(() => validateSvg(svg)).toThrow(),
  );
  it("creates local SVG export metadata", () => {
    expect(exportName("../contoh.png")).toBe("___contoh-nexora.svg");
    expect(svgBlob(valid).type).toBe("image/svg+xml;charset=utf-8");
  });
});
it("three presets have distinct real parameter mappings", () => {
  expect(Object.values(presets).map((p) => p.colors)).toEqual([8, 24, 64]);
  expect(presets.logo.mode).toBe("polygon");
});
describe("worker lifecycle", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("terminates cancelled jobs and rejects stale replies", async () => {
    const workers: FakeWorker[] = [];
    class FakeWorker {
      onmessage?: (event: { data: unknown }) => void;
      onerror?: () => void;
      postMessage = vi.fn();
      terminate = vi.fn();
      constructor() {
        workers.push(this);
      }
    }
    vi.stubGlobal("Worker", FakeWorker);
    const client = new TraceClient();
    const input = () => ({
      rgba: new Uint8ClampedArray(4),
      width: 1,
      height: 1,
    });
    const first = client.run(input(), "logo").catch((e) => e);
    const second = client.run(input(), "photo");
    expect((await first).code).toBe("CANCELLED");
    expect(workers[0].terminate).toHaveBeenCalled();
    const firstId = workers[0].postMessage.mock.calls[0][0].id;
    const secondId = workers[1].postMessage.mock.calls[0][0].id;
    workers[0].onmessage?.({ data: { id: firstId, result: { svg: "old" } } });
    workers[1].onmessage?.({ data: { id: secondId, result: { svg: "new" } } });
    expect((await second).svg).toBe("new");
    expect(workers[1].terminate).toHaveBeenCalled();
  });
});
