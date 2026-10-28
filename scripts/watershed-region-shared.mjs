// Exact directed SVG atom reuse after normalizing decimal parser arithmetic.
import { geometry } from "./curve-geometry-metrics.mjs";
export function sharedAtoms(svg) {
  const g = geometry(svg),
    atoms = new Map();
  let frame = 0;
  for (const p of g.paths)
    for (const e of p.edges) {
      if (
        e.every((q) => Math.abs(q[0]) < 1e-7) ||
        e.every((q) => Math.abs(q[1]) < 1e-7) ||
        e.every((q) => Math.abs(q[0] - g.width) < 1e-7) ||
        e.every((q) => Math.abs(q[1] - g.height) < 1e-7)
      ) {
        frame++;
        continue;
      }
      const f = JSON.stringify(e.map((p) => p.map((x) => +x.toFixed(6)))),
        r = JSON.stringify(
          [...e].reverse().map((p) => p.map((x) => +x.toFixed(6))),
        ),
        key = f < r ? f : r;
      const v = atoms.get(key) ?? [];
      v.push(f < r ? 1 : -1);
      atoms.set(key, v);
    }
  let paired = 0,
    unmatched = 0,
    invalidMultiplicity = 0;
  for (const v of atoms.values()) {
    if (v.length === 2 && v[0] + v[1] === 0) paired++;
    else if (v.length === 1) unmatched++;
    else invalidMultiplicity++;
  }
  return {
    paired,
    unmatched,
    invalidMultiplicity,
    frame,
    definition:
      "Non-frame line/cubic atoms with identical final serialized controls, opposite orientation; decimal parse arithmetic normalized at6 decimal places. Unmatched atoms flag partition-inconsistency, not renderer-only seams.",
  };
}
