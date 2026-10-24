import { createEngine } from "../engine/adapters";
import type { Preset, TraceInput } from "../engine/types";
const engines = new Map<string, ReturnType<typeof createEngine>>();
self.onmessage = async (
  event: MessageEvent<{
    id: number;
    input: TraceInput;
    preset: Preset;
    preferred: "auto" | "fallback";
  }>,
) => {
  const { id, input, preset, preferred } = event.data;
  try {
    const started = performance.now();
    const warm = engines.has(preferred);
    if (!warm) engines.set(preferred, createEngine(preferred));
    const { engine, warning } = await engines.get(preferred)!;
    const startupMs = performance.now() - started;
    const result = await engine.trace(input, preset);
    self.postMessage({
      id,
      result: {
        ...result,
        timings: {
          startupMs,
          workerTotalMs: performance.now() - started,
          warm,
        },
        warning:
          [warning, result.warning].filter(Boolean).join(" ") || undefined,
      },
    });
  } catch (error) {
    self.postMessage({ id, error: { code: "TRACE", message: String(error) } });
  }
};
