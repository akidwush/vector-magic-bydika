import type { Preset, TraceInput, TraceResult, TraceFailure } from "./types";
export class TraceClient {
  private worker?: Worker;
  private serial = 0;
  private idle?: ReturnType<typeof setTimeout>;
  private reject?: (error: TraceFailure) => void;
  private messageError?: () => void;
  cancel(activeOnly = false) {
    if (activeOnly && !this.reject) return;
    if (this.idle) clearTimeout(this.idle);
    this.idle = undefined;
    this.serial++;
    if (this.messageError)
      this.worker?.removeEventListener("messageerror", this.messageError);
    this.messageError = undefined;
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
      let worker: Worker | undefined;
      let settled = false;
      const current = () =>
        !settled && id === this.serial && this.worker === worker;
      const fail = (error: TraceFailure) => {
        if (!current()) return;
        settled = true;
        // Reject with the actual failure, rather than cancel()'s cancellation.
        this.reject = undefined;
        this.cancel();
        reject(error);
      };
      const transportFailure = (error: TraceFailure) => {
        if (id !== this.serial || this.worker !== worker) return;
        // An idle Worker can still fail. Retire it without settling its already
        // completed job again; the next conversion needs a fresh instance.
        if (settled) this.cancel();
        else fail(error);
      };
      this.reject = reject;
      try {
        worker =
          this.worker ??
          new Worker(new URL("../workers/trace.worker.ts", import.meta.url), {
            type: "module",
          });
        this.worker = worker;
        worker.onmessage = ({ data }) => {
          if (!current() || data?.id !== id) return;
          if (data.error) {
            fail(data.error);
            return;
          }
          if (typeof data.result?.svg !== "string") {
            fail({ code: "WORKER", message: "Balasan Worker tidak valid." });
            return;
          }
          settled = true;
          this.reject = undefined;
          this.idle = setTimeout(() => this.cancel(), 30_000);
          resolve(data.result);
        };
        worker.onerror = (event) =>
          transportFailure({
            code: "WORKER",
            message: event.message || "Worker gagal. Coba gambar lebih kecil.",
          });
        if (this.messageError)
          worker.removeEventListener("messageerror", this.messageError);
        this.messageError = () =>
          transportFailure({
            code: "WORKER",
            message:
              "Balasan Worker tidak dapat dibaca. Silakan konversi ulang.",
          });
        // Use the event API: not every browser implements the handler property.
        worker.addEventListener("messageerror", this.messageError);
        worker.postMessage({ id, input, preset, preferred }, [
          input.rgba.buffer,
        ]);
      } catch (error) {
        fail({
          code: "WORKER",
          message:
            error instanceof Error
              ? error.message
              : "Worker gagal dimulai. Silakan coba lagi.",
        });
      }
    });
  }
}
