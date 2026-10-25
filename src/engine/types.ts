export type Preset = "logo" | "illustration" | "photo";
export type EngineId = "vtracer-wasm" | "imagetracerjs";
export interface TraceInput {
  sourceFormat?: string;
  optimize?: boolean;
  sourceRefine?: boolean;
  quality?:
    | "auto"
    | "legacy"
    | "shared"
    | "previous"
    | "pre-source"
    | "planar"
    | "intelligent"
    | "source";
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}
export interface TraceResult {
  svg: string;
  engine: EngineId;
  elapsedMs: number;
  timings?: { startupMs: number; workerTotalMs: number; warm: boolean };
  effectivePrecision?: number;
  corners?: number[];
  sourceModels?: number;
  sourceRefinement?: {
    enabled: boolean;
    attempts: number;
    accepted: number;
    evaluations: number;
    lossBefore: number;
    lossAfter: number;
    elapsedMs: number;
    phase: number;
    initialLoss: number;
    supportInspections: number;
  };
  optimization?: {
    attempts: number;
    accepted: number;
    rejected: number;
    segmentsBefore: number;
    segmentsAfter: number;
    validationSamples: number;
    budgetFallback: boolean;
    elapsedMs: number;
  };
  topology?: {
    vertices: number;
    edges: number;
    faces: number;
    shared: number;
    contours: number;
    incidenceErrors: number;
    repaired: number;
    crossingsBefore: number;
    crossingsAfter: number;
    maxDrift: number;
    pixelFallback: boolean;
    validationBudgetFallback: boolean;
    adaptiveRollback: boolean;
    sourceAccepted: number;
  };
  coverage?: {
    accepted: number;
    rejected: number;
    srgb: number;
    linear: number;
  };
  transitions?: import("./transitions").TransitionEvidence;
  stages?: {
    segmentationMs: number;
    preparationMs?: number;
    fittingMs?: number;
    postprocessMs: number;
    diagnosticsMs: number;
    refinementMs?: number;
    alphaMs?: number;
    exportMs?: number;
    wasmLinearBytes?: number;
  };
  diagnostics?: import("./diagnostics").InputDiagnostics;
  profile?: string;
  version: string;
  capabilities: {
    wasm: boolean;
    cancellation: "terminate-worker";
    partialAlpha: "not-guaranteed" | "unsupported" | "quantized-vector";
  };
  preset: Preset;
  warning?: string;
}
export interface TraceEngine {
  readonly id: EngineId;
  trace(input: TraceInput, preset: Preset): Promise<TraceResult>;
}
export interface TraceFailure {
  code: "INIT" | "TRACE" | "WORKER" | "CANCELLED";
  message: string;
}
export const presets: Record<
  Preset,
  {
    title: string;
    description: string;
    colors: number;
    speckle: number;
    mode: string;
  }
> = {
  logo: {
    title: "Logo · Clean",
    description: "Warna terbatas, sudut tegas",
    colors: 8,
    speckle: 2,
    mode: "polygon",
  },
  illustration: {
    title: "Illustration · Balanced",
    description: "Warna seimbang, kurva halus",
    colors: 24,
    speckle: 2,
    mode: "spline",
  },
  photo: {
    title: "Photo · Detailed",
    description: "Baseline detail foto, bukan hasil fotorealistis",
    colors: 64,
    speckle: 4,
    mode: "spline",
  },
};
