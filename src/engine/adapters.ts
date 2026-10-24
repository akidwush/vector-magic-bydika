import type { TraceEngine, TraceInput, Preset } from "./types";
import { sourcePalette } from "./palette";
import { presets } from "./types";
export async function createEngine(
  preferred: "auto" | "fallback" = "auto",
): Promise<{ engine: TraceEngine; warning?: string }> {
  if (preferred === "auto") {
    try {
      const wasm = await import("./wasm/nexora_wasm");
      await wasm.default();
      return {
        engine: {
          id: "vtracer-wasm",
          async trace(input: TraceInput, preset: Preset) {
            const start = performance.now();
            const precision = wasm.precision_for(
              new Uint8Array(
                input.rgba.buffer,
                input.rgba.byteOffset,
                input.rgba.byteLength,
              ),
              preset,
            );
            const svg = wasm.trace(
              new Uint8Array(
                input.rgba.buffer,
                input.rgba.byteOffset,
                input.rgba.byteLength,
              ),
              input.width,
              input.height,
              preset,
            );
            return {
              svg,
              engine: "vtracer-wasm",
              effectivePrecision: precision,
              version: "1.0.0-alpha.4 / e71343f",
              capabilities: {
                wasm: true,
                cancellation: "terminate-worker",
                partialAlpha: "not-guaranteed",
              },
              preset,
              elapsedMs: performance.now() - start,
            };
          },
        },
      };
    } catch (error) {
      return {
        engine: await fallback(),
        warning: `VTracer tidak dapat dimuat; memakai ImageTracerJS. ${String(error)}`,
      };
    }
  }
  return { engine: await fallback() };
}
async function fallback(): Promise<TraceEngine> {
  const { default: tracer } = await import("imagetracerjs");
  return {
    id: "imagetracerjs",
    async trace(input, preset) {
      const start = performance.now(),
        p = presets[preset];
      const svg = tracer.imagedataToSVG(
        { data: input.rgba, width: input.width, height: input.height },
        {
          numberofcolors: p.colors,
          colorsampling: 2,
          ltres: preset === "logo" ? 1 : 0.5,
          qtres: preset === "photo" ? 0.5 : 1,
          pathomit: p.speckle * p.speckle,
          roundcoords: 2,
          strokewidth: 0,
          ...(preset !== "photo"
            ? { pal: sourcePalette(input.rgba, p.colors), colorquantcycles: 1 }
            : {}),
          desc: false,
        },
      );
      return {
        svg,
        engine: "imagetracerjs",
        version: "1.2.6",
        capabilities: {
          wasm: false,
          cancellation: "terminate-worker",
          partialAlpha: "not-guaranteed",
        },
        preset,
        elapsedMs: performance.now() - start,
        warning:
          "ImageTracerJS: alpha parsial dapat berubah; periksa transparansi hasil.",
      };
    },
  };
}
