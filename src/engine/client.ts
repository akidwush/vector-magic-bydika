import type { Preset, TraceInput, TraceResult, TraceFailure } from "./types";
export class TraceClient {
  private worker?: Worker;
  private serial = 0;
  private reject?: (error: TraceFailure) => void;
  cancel() {
    this.serial++;
    this.worker?.terminate();
    this.worker = undefined;
    this.reject?.({ code: "CANCELLED", message: "Konversi dibatalkan." });
    this.reject = undefined;
  }
  run(
    input: TraceInput,
    preset: Preset,
    preferred: "auto" | "fallback" = "auto",
  ): Promise<TraceResult> {
    this.cancel();
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      this.reject = reject;
      const worker = new Worker(
        new URL("../workers/trace.worker.ts", import.meta.url),
        { type: "module" },
      );
      this.worker = worker;
      const finish = () => {
        worker.terminate();
        if (this.worker === worker) {
          this.worker = undefined;
          this.reject = undefined;
        }
      };
      worker.onmessage = ({ data }) => {
        if (data.id !== id || id !== this.serial) return;
        finish();
        if (data.error) reject(data.error);
        else resolve(data.result);
      };
      worker.onerror = (event) => {
        finish();
        reject({
          code: "WORKER",
          message: event.message || "Worker gagal. Coba gambar lebih kecil.",
        });
      };
      worker.postMessage({ id, input, preset, preferred }, [input.rgba.buffer]);
    });
  }
}
