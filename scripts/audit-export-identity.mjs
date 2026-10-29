// Compare actual old/new browser downloads. No SVG is passed to the engine.
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const base = resolve(process.env.NEXORA_AUDIT_BASE),
  candidate = resolve(process.env.NEXORA_AUDIT_CANDIDATE),
  output = process.env.NEXORA_AUDIT_IDENTITY,
  sha = (b) => createHash("sha256").update(b).digest("hex"),
  files = (await readdir(base, { recursive: true })).filter((p) =>
    p.endsWith(".svg"),
  ),
  actual = new Set(await readdir(candidate, { recursive: true })),
  rows = [],
  issues = [];
if (!files.length) throw Error("No baseline SVGs");
for (const file of files) {
  if (!actual.has(file)) {
    issues.push(file + ": missing candidate");
    continue;
  }
  const a = sha(await readFile(base + "/" + file)),
    b = sha(await readFile(candidate + "/" + file));
  rows.push({ file, baselineSHA256: a, candidateSHA256: b });
  if (a !== b) issues.push(file + ": changed bytes");
}
const icon = files.filter((p) => p.endsWith("/icon.png-illustration.svg"));
if (icon.length !== 1) throw Error("Missing unique original app icon download");
const expected = sha(await readFile(base + "/" + icon[0])),
  recovered = [...actual].filter((p) => p.endsWith("/recovered.svg"));
if (recovered.length !== 4)
  issues.push("Missing four actual fault-recovery downloads");
for (const file of recovered) {
  const hash = sha(await readFile(candidate + "/" + file));
  if (hash !== expected) issues.push(file + ": recovery changed SVG");
  rows.push({ file, baselineSHA256: expected, candidateSHA256: hash });
}
const report = {
  status: issues.length ? "FAIL" : "PASS",
  baseline: base,
  candidate,
  priorExports: files.length,
  recoveryExports: recovered.length,
  scope:
    "Byte identity of actual Chromium SVG downloads; not a new quality or latency score.",
  issues,
  rows,
};
await writeFile(output, JSON.stringify(report, null, 2), { flag: "wx" });
console.log({
  status: report.status,
  priorExports: files.length,
  recoveryExports: recovered.length,
  issues,
});
if (issues.length) process.exitCode = 1;
