import type { Preset, TraceInput, TraceResult, TraceFailure } from "./types";
export class TraceClient {
  private worker?: Worker;
  private serial = 0;
  private idle?: ReturnType<typeof setTimeout>;
  private reject?: (error: TraceFailure) => void;
  cancel(activeOnly = false) {
    if (activeOnly && !this.reject) return;
    if (this.idle) clearTimeout(this.idle);
    this.idle = undefined;
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
    if (this.idle) clearTimeout(this.idle);
    this.idle = undefined;
    if (this.reject) this.cancel();
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      this.reject = reject;
      const worker =
        this.worker ??
        new Worker(new URL("../workers/trace.worker.ts", import.meta.url), {
          type: "module",
        });
      this.worker = worker;
      const finish = () => {
        if (this.worker === worker) this.reject = undefined;
      };
      worker.onmessage = ({ data }) => {
        if (data.id !== id || id !== this.serial) return;
        finish();
        if (data.error) {
          this.cancel();
          reject(data.error);
        } else {
          this.idle = setTimeout(() => this.cancel(), 30_000);
          resolve(data.result);
        }
      };
      worker.onerror = (event) => {
        if (id !== this.serial || this.worker !== worker) return;
        finish();
        this.cancel();
        reject({
          code: "WORKER",
          message: event.message || "Worker gagal. Coba gambar lebih kecil.",
        });
      };
      worker.postMessage({ id, input, preset, preferred }, [input.rgba.buffer]);
    });
  }
}
