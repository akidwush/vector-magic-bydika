import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TraceClient } from "../../src/engine/client";

const input = () => ({ rgba: new Uint8ClampedArray(4), width: 1, height: 1 });
const workers: FakeWorker[] = [];
let client: TraceClient;
class FakeWorker extends EventTarget {
  onmessage?: (event: { data: unknown }) => void;
  onerror?: (event: { message: string }) => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    super();
    workers.push(this);
  }
  reply(svg = "valid") {
    const id = this.postMessage.mock.calls.at(-1)![0].id;
    this.onmessage?.({ data: { id, result: { svg } } });
  }
  messageError() {
    this.dispatchEvent(new MessageEvent("messageerror"));
  }
}
beforeEach(() => {
  workers.length = 0;
  client = new TraceClient();
  vi.useFakeTimers();
  vi.stubGlobal("Worker", FakeWorker);
});
afterEach(() => {
  client.cancel();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("reports blocked Worker creation and can start a fresh conversion", async () => {
  vi.stubGlobal(
    "Worker",
    class {
      constructor() {
        throw new DOMException("Worker blocked", "SecurityError");
      }
    },
  );
  await expect(client.run(input(), "logo")).rejects.toMatchObject({
    code: "WORKER",
  });
  vi.stubGlobal("Worker", FakeWorker);
  const next = client.run(input(), "logo");
  workers[0].reply("retry");
  expect((await next).svg).toBe("retry");
});

it("terminates a Worker when transferring the request fails", async () => {
  const bad = new FakeWorker();
  bad.postMessage.mockImplementation(() => {
    throw new DOMException("Cannot clone", "DataCloneError");
  });
  vi.stubGlobal(
    "Worker",
    class {
      constructor() {
        return bad;
      }
    },
  );
  await expect(client.run(input(), "logo")).rejects.toMatchObject({
    code: "WORKER",
  });
  expect(bad.terminate).toHaveBeenCalledOnce();
  vi.stubGlobal("Worker", FakeWorker);
  const next = client.run(input(), "logo");
  workers[1].reply("fresh");
  expect((await next).svg).toBe("fresh");
});

it("settles an unreadable reply instead of leaving the conversion pending", async () => {
  let failure: unknown;
  const pending = client.run(input(), "logo").catch((e: unknown) => {
    failure = e;
  });
  workers[0].messageError();
  await Promise.resolve();
  expect(failure).toMatchObject({ code: "WORKER" });
  expect(workers[0].terminate).toHaveBeenCalledOnce();
  await pending;
  const next = client.run(input(), "logo");
  // A transport failure from the obsolete Worker cannot kill the new job.
  workers[0].messageError();
  expect(workers[1].terminate).not.toHaveBeenCalled();
  workers[1].reply("recovered");
  expect((await next).svg).toBe("recovered");
});

it("ignores a duplicate result so its idle timer cannot cancel the next job", async () => {
  const first = client.run(input(), "logo");
  workers[0].reply();
  await first;
  vi.advanceTimersByTime(1000);
  workers[0].reply("duplicate");
  vi.advanceTimersByTime(1000);
  const next = client.run(input(), "logo").catch((e: unknown) => e);
  vi.advanceTimersByTime(28_000);
  expect(workers[0].terminate).not.toHaveBeenCalled();
  workers[0].reply("warm");
  expect(await next).toMatchObject({ svg: "warm" });
  vi.advanceTimersByTime(30_000);
  expect(workers[0].terminate).toHaveBeenCalledOnce();
});

it("discards a Worker that fails after a completed job instead of reusing it", async () => {
  const first = client.run(input(), "logo");
  workers[0].reply("finished");
  expect((await first).svg).toBe("finished");
  workers[0].onerror?.({ message: "idle Worker failed" });
  expect(workers[0].terminate).toHaveBeenCalledOnce();
  const next = client.run(input(), "logo");
  expect(workers).toHaveLength(2);
  workers[1].reply("fresh after idle failure");
  expect((await next).svg).toBe("fresh after idle failure");
});
