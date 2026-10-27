// Extract the actual historical callback, keeping the historical file untouched.
import ts from "typescript";
import { runInNewContext } from "node:vm";
export function callbacks(source) {
  const ast = ts.createSourceFile(
    "legacy.mjs",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  let found;
  function walk(n) {
    if (
      ts.isCallExpression(n) &&
      n.expression.getText(ast) === "page.evaluate" &&
      ts.isArrowFunction(n.arguments[0])
    ) {
      const f = n.arguments[0];
      if (f.parameters[0]?.name.getText(ast).includes("keys, bytes, w, h"))
        found = f.getText(ast);
    }
    ts.forEachChild(n, walk);
  }
  walk(ast);
  if (!found) throw Error("Historical callback not found; audit required");
  const replace = (s, a, b) => {
    if (s.split(a).length !== 2) throw Error("Historical anchor changed: " + a);
    return s.replace(a, b);
  };
  let marked = replace(
    found,
    "{ keys, bytes, w, h }",
    "{ keys, bytes, w, h, diagnosticId, detail }",
  );
  marked = replace(marked, "const data =", "const calls = [];\nconst data =");
  marked = replace(
    marked,
    "const m = modules[key],",
    `performance.mark('nexora-legacy-start-'+diagnosticId+'-'+round+'-'+key);\nconst m = modules[key],`,
  );
  marked = replace(
    marked,
    "const stages = [...m.last_stage_timings()];",
    `performance.mark('nexora-legacy-end-'+diagnosticId+'-'+round+'-'+key);\nconst stages = [...m.last_stage_timings()];`,
  );
  const anchor = "record.warmStages.push(stages);\n            }";
  marked = replace(
    marked,
    anchor,
    anchor +
      `\n calls.push({id:diagnosticId+'-'+round+'-'+key,key,round,coreMs:elapsed,start:started,end:started+elapsed,stages, runtime:detail&&m.last_runtime_profile?[...m.last_runtime_profile()]:null,inverseWork:detail&&m.last_inverse_work?[...m.last_inverse_work()]:null,legacyWork:detail&&m.last_legacy_work?[...m.last_legacy_work()]:null,profileNames:detail&&m.runtime_profile_names?m.runtime_profile_names().split('|'):null,legacyNames:detail&&m.legacy_work_names?m.legacy_work_names().split('|'):null,inverseNames:detail&&m.inverse_work_names?m.inverse_work_names().split('|'):null});`,
  );
  marked = replace(
    marked,
    "return outputs;",
    "return {outputs,calls,timeOrigin:performance.timeOrigin};",
  );
  return {
    original: runInNewContext("(" + found + ")"),
    marked: runInNewContext("(" + marked + ")"),
    originalSource: found,
    markedSource: marked,
  };
}
// Conservative bounds, never interpolated point estimates. Each read occurs at
// an unknown instant within [loUs,hiUs]. Core timestamps use the same monotonic clock.
export function cpuBounds(samples, start, end) {
  const pre = samples.filter((s) => s.hiUs <= start).at(-1),
    post = samples.find((s) => s.loUs >= end);
  const inside = samples.filter((s) => s.loUs >= start && s.hiUs <= end);
  const first = inside[0],
    last = inside.at(-1);
  const delta = (a, b, k) =>
    a && b && b[k] >= a[k] ? (b[k] - a[k]) / 1e6 : null;
  return {
    cpuLowerMs: first && last ? delta(first, last, "cpuNs") : 0,
    cpuUpperMs: delta(pre, post, "cpuNs"),
    waitLowerMs: first && last ? delta(first, last, "waitNs") : 0,
    waitUpperMs: delta(pre, post, "waitNs"),
    runPeriodsUpperDelta: pre && post ? post.runs - pre.runs : null,
    insideSamples: inside.length,
    beforeUs: pre?.hiUs ?? null,
    afterUs: post?.loUs ?? null,
    policy:
      "Read-window conservative bounds; no interpolation or elapsed-as-CPU substitution.",
  };
}
