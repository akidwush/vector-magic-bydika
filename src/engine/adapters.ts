import type { TraceEngine, TraceInput, Preset } from "./types";
import { analyzeTransitions } from "./transitions";
import { analyzeInput, chooseProfile, canReconstruct } from "./diagnostics";
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
            const baseProfile = chooseProfile(
              diagnostics,
              preset,
              input.quality,
            );
            const refine =
              ["auto", "pre-source"].includes(input.quality ?? "auto") &&
              preset !== "photo" &&
              diagnostics.dominantCoverage >= 0.85;
            const alphaSupported =
              refine ||
              baseProfile === "planar" ||
              baseProfile === "intelligent" ||
              baseProfile === "source";
            const profile =
              baseProfile === "source"
                ? diagnostics.alphaPartialFraction === 0 &&
                  diagnostics.alphaZeroFraction === 0 &&
                  canReconstruct(diagnostics)
                  ? diagnostics.classification === "blended-flat"
                    ? "reconstruct-blend"
                    : "reconstruct"
                  : diagnostics.classification === "blended-flat"
                    ? "source-blend"
                    : "source"
                : baseProfile === "intelligent" &&
                    canReconstruct(diagnostics) &&
                    diagnostics.alphaPartialFraction === 0 &&
                    diagnostics.alphaZeroFraction === 0
                  ? "reconstruct-planar"
                  : refine
                    ? `coverage-${baseProfile}`
                    : baseProfile;
            const transitions =
              preset === "photo" ? undefined : analyzeTransitions(input);
            const diagnosticsMs = performance.now() - start;
            const precision = wasm.precision_for(
              new Uint8Array(
                input.rgba.buffer,
                input.rgba.byteOffset,
                input.rgba.byteLength,
              ),
              preset,
            );
            const inverseEligible =
              !!input.sourceRefine &&
              preset === "illustration" &&
              canReconstruct(diagnostics) &&
              diagnostics.alphaPartialFraction === 0 &&
              diagnostics.alphaZeroFraction === 0 &&
              ["source", "planar", "intelligent"].includes(baseProfile);
            const svg = wasm.trace_quality(
              new Uint8Array(
                input.rgba.buffer,
                input.rgba.byteOffset,
                input.rgba.byteLength,
              ),
              input.width,
              input.height,
              preset,
              (inverseEligible ? "inverse-" : "") +
                (input.optimize !== false &&
                preset !== "photo" &&
                ["auto", "source", "planar", "intelligent"].includes(
                  input.quality ?? "auto",
                )
                  ? `reduce-${profile}`
                  : profile),
            );
            const optimizationData = wasm.last_optimization();
            const inverseData = wasm.last_inverse();
            const topologyData = wasm.last_topology();
            const recoveryGetter = Reflect.get(wasm, "last_recovery") as
              undefined | (() => Float64Array);
            const recovery =
              typeof recoveryGetter === "function"
                ? recoveryGetter()
                : undefined;
            return {
              svg,
              engine: "vtracer-wasm",
              effectivePrecision: precision,
              profile,
              diagnostics,
              transitions,
              coverage: {
                accepted: wasm.last_coverage_evidence()[0],
                rejected: wasm.last_coverage_evidence()[1],
                srgb: wasm.last_coverage_evidence()[2],
                linear: wasm.last_coverage_evidence()[3],
              },
              corners: Array.from(wasm.last_corner_evidence()),
              sourceModels: wasm.last_source_models(),
              sourceRefinement: {
                enabled: inverseEligible,
                attempts: inverseData[0],
                accepted: inverseData[1],
                evaluations: inverseData[2],
                lossBefore: inverseData[3],
                lossAfter: inverseData[4],
                elapsedMs: inverseData[5],
                phase: inverseData[6],
                initialLoss: inverseData[7],
                supportInspections: inverseData[8],
              },
              sourceGeometry: recovery
                ? {
                    components: recovery[0],
                    accepted: recovery[1],
                    coverageEvaluations: recovery[2],
                    axisUpdates: recovery[3],
                    spliceCollapsed: recovery[4],
                    apexUpdates: recovery[5],
                    apexLossBefore: recovery[6],
                    apexLossAfter: recovery[7],
                    coverageLossBefore: recovery[8],
                    coverageLossAfter: recovery[9],
                    rejected: recovery[10],
                    elapsedMs: recovery[11],
                    targetObservations: recovery[12],
                    wedgeRejected: recovery[13],
                    spansAttempted: recovery[14],
                    spansAccepted: recovery[15],
                    straightLocks: recovery[16],
                    spanMs: recovery[17],
                    cornerMs: recovery[18],
                    deferredContexts: recovery[19] || 0,
                    acuteCandidates: recovery[20] || 0,
                    intersectionModels: recovery[21] || 0,
                    acuteRecovered: recovery[22] || 0,
                    uncertainCaps: recovery[23] || 0,
                    initializationMs: recovery[24] || 0,
                    capLossBefore: recovery[27] || 0,
                    capLossAfter: recovery[28] || 0,
                    canonicalOwners: recovery[29] || 0,
                  }
                : undefined,
              optimization: {
                attempts: optimizationData[0],
                accepted: optimizationData[1],
                rejected: optimizationData[2],
                segmentsBefore: optimizationData[3],
                segmentsAfter: optimizationData[4],
                validationSamples: optimizationData[5],
                budgetFallback: !!optimizationData[6],
                elapsedMs: optimizationData[7],
              },
              topology: topologyData.length
                ? {
                    vertices: topologyData[0],
                    edges: topologyData[1],
                    faces: topologyData[2],
                    shared: topologyData[3],
                    contours: topologyData[4],
                    incidenceErrors: topologyData[5],
                    repaired: topologyData[6],
                    crossingsBefore: topologyData[7],
                    crossingsAfter: topologyData[8],
                    maxDrift: topologyData[9],
                    pixelFallback: !!topologyData[10],
                    validationBudgetFallback: !!topologyData[11],
                    adaptiveRollback: !!topologyData[12],
                    sourceAccepted: topologyData[13],
                  }
                : undefined,
              stages: {
                segmentationMs: wasm.last_stage_timings()[0],
                preparationMs: wasm.last_stage_timings()[5],
                fittingMs: wasm.last_stage_timings()[6],
                postprocessMs: wasm.last_stage_timings()[1],
                diagnosticsMs,
                refinementMs: wasm.last_stage_timings()[2],
                alphaMs: wasm.last_stage_timings()[3],
                exportMs: wasm.last_stage_timings()[4],
                wasmLinearBytes: core.memory.buffer.byteLength,
              },
              warning:
                diagnostics.alphaPartialFraction > 0
                  ? alphaSupported
                    ? "Alpha direkonstruksi dengan mask kontur vektor bertingkat; bukan opacity kontinu persis."
                    : "Kualitas alpha parsial BELUM DIDUKUNG: opacity tepi dapat berubah. Hasil ini bukan rekonstruksi transparansi yang setia."
                  : baseProfile === "planar"
                    ? "Shared edge dikunci secara geometris; renderer SVG masih dapat menampilkan hairline antialias."
                    : undefined,
              version: "1.0.0-alpha.4 / e71343f",
              capabilities: {
                wasm: true,
                cancellation: "terminate-worker",
                partialAlpha:
                  diagnostics.alphaPartialFraction > 0
                    ? alphaSupported
                      ? "quantized-vector"
                      : "unsupported"
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
            : input.quality === "planar"
              ? "Fallback ImageTracerJS tidak mendukung shared edge terkunci. Pilih VTracer untuk mode ini."
              : "ImageTracerJS memakai palette sumber; detail warna sangat kecil dapat berkurang.",
      };
    },
  };
}
