import type { TraceEngine, TraceInput, Preset } from "./types";
import { analyzeInput, chooseProfile } from "./diagnostics";
import { sourcePalette } from "./palette";
import { presets } from "./types";
export async function createEngine(
  preferred: "auto" | "fallback" = "auto",
): Promise<{ engine: TraceEngine; warning?: string }> {
  if (preferred === "auto") {
    try {
      const wasm = await import("./wasm/nexora_wasm");
      const core = await wasm.default();
      return {
        engine: {
          id: "vtracer-wasm",
          async trace(input: TraceInput, preset: Preset) {
            const start = performance.now();
            const diagnostics = analyzeInput(input);
            const profile = chooseProfile(diagnostics, preset, input.quality);
            const diagnosticsMs = performance.now() - start;
            const precision = wasm.precision_for(
              new Uint8Array(
                input.rgba.buffer,
                input.rgba.byteOffset,
                input.rgba.byteLength,
              ),
              preset,
            );
            const svg = wasm.trace_quality(
              new Uint8Array(
                input.rgba.buffer,
                input.rgba.byteOffset,
                input.rgba.byteLength,
              ),
              input.width,
              input.height,
              preset,
              profile,
            );
            return {
              svg,
              engine: "vtracer-wasm",
              effectivePrecision: precision,
              profile,
              diagnostics,
              stages: {
                segmentationMs: wasm.last_stage_timings()[0],
                postprocessMs: wasm.last_stage_timings()[1],
                diagnosticsMs,
                wasmLinearBytes: core.memory.buffer.byteLength,
              },
              warning:
                diagnostics.alphaPartialFraction > 0
                  ? "Kualitas alpha parsial BELUM DIDUKUNG: opacity tepi dapat berubah. Hasil ini bukan rekonstruksi transparansi yang setia."
                  : undefined,
              version: "1.0.0-alpha.4 / e71343f",
              capabilities: {
                wasm: true,
                cancellation: "terminate-worker",
                partialAlpha:
                  diagnostics.alphaPartialFraction > 0
                    ? "unsupported"
                    : "not-guaranteed",
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
      const diagnostics = analyzeInput(input);
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
        diagnostics,
        profile: "fallback-palette",
        version: "1.2.6",
        capabilities: {
          wasm: false,
          cancellation: "terminate-worker",
          partialAlpha: "not-guaranteed",
        },
        preset,
        elapsedMs: performance.now() - start,
        warning:
          diagnostics.alphaPartialFraction > 0
            ? "Kualitas alpha parsial BELUM DIDUKUNG oleh fallback; opacity hasil dapat berubah."
            : "ImageTracerJS memakai palette sumber; detail warna sangat kecil dapat berkurang.",
      };
    },
  };
}
