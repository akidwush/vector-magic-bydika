// Per-thread CPU snapshots and cgroup evidence; clocks are outside trace calls.
import { readFile, readdir } from "node:fs/promises";
export async function optional(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}
export async function snapshot(cdp) {
  const { processInfo } = await cdp.send("SystemInfo.getProcessInfo");
  const threads = {};
  for (const p of processInfo) {
    let tids = [];
    try {
      tids = await readdir(`/proc/${p.id}/task`);
    } catch {}
    for (const tid of tids) {
      const base = `/proc/${p.id}/task/${tid}`;
      const [comm, stat] = await Promise.all([
        optional(base + "/comm"),
        optional(base + "/schedstat"),
      ]);
      if (comm && stat) {
        const [run, wait] = stat.trim().split(/\s+/).map(Number);
        threads[p.id + ":" + tid] = {
          processType: p.type,
          comm: comm.trim(),
          run,
          wait,
        };
      }
    }
  }
  return {
    processInfo,
    threads,
    cgroup: await optional("/sys/fs/cgroup/cpu.stat"),
    pressure: await optional("/sys/fs/cgroup/cpu.pressure"),
    frequency: await optional(
      "/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq",
    ),
  };
}
export function deltaCPU(a, b) {
  return Object.entries(b.threads)
    .flatMap(([id, t]) =>
      a.threads[id] && t.run >= a.threads[id].run
        ? [
            {
              id,
              comm: t.comm,
              processType: t.processType,
              cpuMs: (t.run - a.threads[id].run) / 1e6,
              runqueueMs: (t.wait - a.threads[id].wait) / 1e6,
            },
          ]
        : [],
    )
    .sort((a, b) => b.cpuMs - a.cpuMs);
}
