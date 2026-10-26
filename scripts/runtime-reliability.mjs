import { readFile, writeFile } from "node:fs/promises";
import { distribution } from "./runtime-statistics.mjs";
const root = process.env.NEXORA_RUNTIME_ROOT;
if (!root) throw Error("Set isolated complete runtime proof root");
const distributions = JSON.parse(
  await readFile(root + "/distributions/observations.json"),
);
const profile = JSON.parse(await readFile(root + "/profile/observations.json"));
const failures = [];
const grouped = [];
for (const fixture of [...new Set(distributions.map((r) => r.fixture))])
  for (const pair of [...new Set(distributions.map((r) => r.pair))])
    for (const state of ["first", "warm", "reset"]) {
      const a = distributions.filter(
        (r) => r.fixture === fixture && r.pair === pair && r.state === state,
      );
      const slots = [0, 1].map((slot) => {
        const rows = a.filter((r) => r.slot === slot);
        return {
          wasm: distribution(rows.map((r) => r.wasmMs)),
          browser: distribution(rows.map((r) => r.browserRoundTripMs)),
          workerCPU: distribution(
            rows.map((r) =>
              r.cpu
                .filter((t) => t.comm.includes("DedicatedWorker"))
                .reduce((s, t) => s + t.cpuMs, 0),
            ),
          ),
          runqueue: distribution(
            rows.map((r) =>
              r.cpu
                .filter((t) => t.comm.includes("DedicatedWorker"))
                .reduce((s, t) => s + t.runqueueMs, 0),
            ),
          ),
          startup: distribution(
            rows.map((r) => r.initialization.startupRoundTripMs),
          ),
          hashes: [...new Set(rows.map((r) => r.hash))],
        };
      });
      if (slots.some((s) => s.hashes.length !== 1))
        failures.push({
          fixture,
          pair,
          state,
          reason: "nondeterministic geometry",
        });
      if (pair !== "E/F" && slots[0].hashes[0] !== slots[1].hashes[0])
        failures.push({ fixture, pair, state, reason: "identity mismatch" });
      grouped.push({
        fixture,
        pair,
        state,
        slots,
        additionalMedianMs: slots[1].wasm.median - slots[0].wasm.median,
      });
    }
const profileSummary = [];
for (const fixture of [...new Set(profile.map((r) => r.fixture))])
  for (const slot of [0, 1]) {
    const rows = profile.filter(
      (r) => r.fixture === fixture && r.slot === slot,
    );
    if (rows.some((r) => r.runtime[0] !== 1))
      failures.push({
        fixture,
        slot,
        reason: "profiling did not reset at every trace entry",
      });
    if (rows.some((r) => r.runtime[21] !== r.recovery[1] + r.runtime[22]))
      failures.push({
        fixture,
        slot,
        reason: "eligible component accounting mismatch",
      });
    const signatures = [
      ...new Set(rows.map((r) => JSON.stringify(r.runtime.slice(0, 32)))),
    ];
    if (signatures.length !== 1)
      failures.push({
        fixture,
        slot,
        reason: "work counts vary for identical input",
      });
    if (
      fixture === "triangle-512" &&
      rows.some((r) => r.runtime[9] !== 0 || r.runtime[30] !== 0)
    )
      failures.push({ fixture, reason: "unnecessary large-apex recovery" });
    const warm = rows.filter((r) => r.state === "warm");
    profileSummary.push({
      fixture,
      slot,
      counters: rows[0].runtime.slice(0, 32),
      names: rows[0].profileNames,
      inclusiveMs: rows[0].profileNames.map((name, i) => ({
        name,
        distribution: distribution(warm.map((r) => r.runtime[32 + i])),
      })),
      workSignatures: signatures.length,
    });
  }
const result = {
  status: failures.length ? "FAIL" : "PARTIAL",
  invariantStatus: failures.length ? "FAIL" : "PASS",
  reason:
    "Distributions and work attribution are measured; no causal claim about the historical 747ms episode follows from a non-reproduction. This diagnostic report never overrides historical timing gates.",
  observations: distributions.length,
  profileObservations: profile.length,
  grouped,
  profileSummary,
  failures,
  android: "UNVERIFIED: no physical device attached",
};
await writeFile(root + "/reliability.json", JSON.stringify(result, null, 2));
console.log({
  status: result.status,
  invariantStatus: result.invariantStatus,
  observations: result.observations,
  failures,
});
if (failures.length) process.exitCode = 1;
