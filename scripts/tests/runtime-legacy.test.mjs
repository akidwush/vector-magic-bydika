import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { callbacks, cpuBounds } from "../runtime-legacy-protocol.mjs";
test("historical callback extraction preserves eight calls and the one-callback protocol", async () => {
  const source = await readFile("scripts/low-resolution-benchmark.mjs", "utf8");
  const { original, marked } = callbacks(source);
  for (const fn of [original, marked]) {
    const calls = [];
    const modules = {};
    // Execute the extracted source after replacing only module import with a test double.
    for (const key of ["F", "H"])
      modules[key] = {
        default: async () => ({ memory: { buffer: { byteLength: 1 } } }),
        trace_quality: (...a) => {
          calls.push([key, ...a.slice(1)]);
          return key + a.at(-1);
        },
        last_stage_timings: () => [1],
        last_inverse: () => [],
      };
    const text = fn
      .toString()
      .replace(
        'await import("/" + key + "/nexora_wasm.js")',
        "testModules[key]",
      );
    const run = new Function(
      "testModules",
      "performance",
      "atob",
      `return (${text})`,
    )(modules, performance, atob);
    await run({
      keys: ["F", "H"],
      bytes: "AA==",
      w: 1,
      h: 1,
      diagnosticId: "test",
    });
    assert.deepEqual(
      calls.map((c) => c[0]),
      ["F", "H", "H", "F", "F", "H", "F", "H"],
    );
    assert(
      calls.slice(0, 6).every((c) => c.at(-1) === "inverse-reduce-reconstruct"),
    );
    assert(calls.slice(6).every((c) => c.at(-1) === "reduce-reconstruct"));
  }
});
test("CPU bounds contain burst between reads, exclude outside work, and refuse missing brackets", () => {
  const s = [
    { loUs: 0, hiUs: 1, cpuNs: 0, waitNs: 0 },
    { loUs: 3, hiUs: 4, cpuNs: 1000000, waitNs: 0 },
    { loUs: 6, hiUs: 7, cpuNs: 5000000, waitNs: 2000000 },
    { loUs: 9, hiUs: 10, cpuNs: 6000000, waitNs: 2000000 },
  ];
  const b = cpuBounds(s, 2, 8);
  assert.equal(b.cpuLowerMs, 4);
  assert.equal(b.cpuUpperMs, 6);
  assert.equal(b.waitLowerMs, 2);
  assert.equal(cpuBounds(s, -1, 8).cpuUpperMs, null);
  assert.equal(cpuBounds(s, 2, 11).cpuUpperMs, null);
});
