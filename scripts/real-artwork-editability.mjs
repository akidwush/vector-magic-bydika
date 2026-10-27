// Structural facts; box overlap does not prove unnecessary paint overlap.
import { geometry } from "./curve-geometry-metrics.mjs";
export function editability(svg) {
  const g = geometry(svg),
    counts = g.paths.map((p) => p.anchors).sort((a, b) => a - b),
    maskRanges = [...svg.matchAll(/<mask\b[\s\S]*?<\/mask>/g)].map((m) => [
      m.index,
      m.index + m[0].length,
    ]),
    paths = [...svg.matchAll(/<path\b[^>]*>/g)],
    maskPaths = paths.filter((m) =>
      maskRanges.some(([a, b]) => m.index >= a && m.index < b),
    ).length;
  const boxes = g.paths.map((p, i) => {
    if (
      maskRanges.some(([a, b]) => paths[i]?.index >= a && paths[i]?.index < b)
    )
      return null;
    const ps = p.edges.flat();
    if (!ps.length) return null;
    const x = ps.map((p) => p[0]),
      y = ps.map((p) => p[1]);
    return [Math.min(...x), Math.min(...y), Math.max(...x), Math.max(...y)];
  });
  let overlaps = 0,
    containments = 0,
    checks = 0,
    complete = true;
  outer: for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i],
        b = boxes[j];
      if (!a || !b) continue;
      if (++checks > 200000) {
        complete = false;
        break outer;
      }
      if (a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]) {
        overlaps++;
        if (
          (a[0] <= b[0] && a[1] <= b[1] && a[2] >= b[2] && a[3] >= b[3]) ||
          (b[0] <= a[0] && b[1] <= a[1] && b[2] >= a[2] && b[3] >= a[3])
        )
          containments++;
      }
    }
  return {
    paintPaths: paths.length - maskPaths,
    maskPaths,
    anchorsPerPath: counts,
    maxPathAnchors: counts.at(-1) ?? 0,
    medianPathAnchors: counts[Math.floor(counts.length / 2)] ?? 0,
    p95PathAnchors: counts[Math.floor(counts.length * 0.95)] ?? 0,
    boxOverlapPairs: overlaps,
    boxContainmentPairs: containments,
    boxChecks: checks,
    boxStatus: complete ? "MEASURED" : "BUDGET_EXCEEDED",
    overlapDefinition:
      "Control-point bounding boxes, including intended background underpainting. Candidate counts only; not unnecessary overlaps or region containment proof.",
  };
}
