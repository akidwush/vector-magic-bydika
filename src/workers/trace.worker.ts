import { createEngine } from "../engine/adapters";
import type { Preset, TraceInput } from "../engine/types";
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
    const { engine, warning } = await createEngine(preferred);
    const result = await engine.trace(input, preset);
    self.postMessage({
      id,
      result: {
        ...result,
        warning:
          [warning, result.warning].filter(Boolean).join(" ") || undefined,
      },
    });
  } catch (error) {
    self.postMessage({ id, error: { code: "TRACE", message: String(error) } });
  }
};
