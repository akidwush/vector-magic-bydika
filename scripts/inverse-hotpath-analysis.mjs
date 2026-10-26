// Independent distributions, not a replacement for any historical timing gate.
import { readFile, writeFile } from "node:fs/promises";
import { distribution } from "./runtime-statistics.mjs";
const root = process.env.NEXORA_RUNTIME_ROOT;
if (!root) throw Error("Set immutable Stage H runtime root");
const rows = JSON.parse(
  await readFile(root + "/distributions/observations.json"),
);
const profiles = JSON.parse(
  await readFile(root + "/profile/observations.json"),
);
const failures = [],
  comparisons = [],
  work = [];
for (const fixture of [...new Set(rows.map((r) => r.fixture))]) {
  for (const pair of [...new Set(rows.map((r) => r.pair))]) {
    const r = rows.filter((r) => r.fixture === fixture && r.pair === pair);
    if (new Set(r.map((r) => r.hash)).size !== 1)
      failures.push(`${fixture} ${pair} SVG identity`);
    const sessions = [...new Set(r.map((r) => r.rep))].map((rep) => {
      const s = r.filter((r) => r.rep === rep && r.state === "warm");
      const med = [0, 1].map(
        (slot) =>
          distribution(s.filter((r) => r.slot === slot).map((r) => r.wasmMs))
            .median,
      );
      return { rep, medians: med, delta: med[1] - med[0] };
    });
    const states = ["first", "warm", "reset"].map((state) => ({
      state,
      slots: [0, 1].map((slot) => {
        const a = r.filter((r) => r.slot === slot && r.state === state);
        return {
          wasm: distribution(a.map((r) => r.wasmMs)),
          browser: distribution(a.map((r) => r.browserRoundTripMs)),
          cpu: distribution(
            a.map((r) =>
              r.cpu
                .filter((t) => t.comm.includes("DedicatedWorker"))
                .reduce((s, t) => s + t.cpuMs, 0),
            ),
          ),
          runqueue: distribution(
            a.map((r) =>
              r.cpu
                .filter((t) => t.comm.includes("DedicatedWorker"))
                .reduce((s, t) => s + t.runqueueMs, 0),
            ),
          ),
          memory: distribution(a.map((r) => r.memory)),
          startup: distribution(
            a.map((r) => r.initialization.startupRoundTripMs),
          ),
        };
      }),
    }));
    comparisons.push({
      fixture,
      pair,
      sessions,
      pairedMedianDelta: distribution(sessions.map((s) => s.delta)),
      states,
    });
  }
}
for (const fixture of [...new Set(profiles.map((r) => r.fixture))]) {
  const slots = [0, 1].map((slot) => {
    const r = profiles.filter((r) => r.fixture === fixture && r.slot === slot);
    const sig = [
      ...new Set(r.map((r) => JSON.stringify(r.inverseWork.slice(0, 16)))),
    ];
    if (sig.length !== 1) failures.push(`${fixture} slot${slot} work varies`);
    return {
      counts: Object.fromEntries(
        r[0].inverseWorkNames.map((n, i) => [n, r[0].inverseWork[i]]),
      ),
      inclusiveMs: Object.fromEntries(
        r[0].inverseWorkNames.map((n, i) => [
          n,
          distribution(
            r
              .filter((r) => r.state === "warm")
              .map((r) => r.inverseWork[16 + i]),
          ),
        ]),
      ),
    };
  });
  work.push({ fixture, slots });
}
const result = {
  status: failures.length ? "FAIL" : "MEASURED",
  observations: rows.length,
  profileObservations: profiles.length,
  comparisons,
  work,
  failures,
  limitation:
    "All samples retained. Paired session medians are independent Worker sessions, not independent machines. Inclusive times must not be summed. No historical runtime threshold is replaced; this report does not automatically promote an optimization.",
};
await writeFile(
  root + "/inverse-hotpath-analysis.json",
  JSON.stringify(result, null, 2),
);
console.log({ status: result.status, observations: rows.length, failures });
if (failures.length) process.exitCode = 1;
