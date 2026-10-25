// This is a promotion gate, separate from build/unit/regression success.
import { readFile } from "node:fs/promises";
const rows = JSON.parse(
  await readFile("benchmark-results/stage15/evidence.json"),
);
const failed = JSON.parse(
  await readFile("benchmark-results/stage15/stretch-failures.json"),
);
for (const row of rows) {
  if (row.cornerAccuracy && row.cornerAccuracy[0].expected) {
    const [a, b] = row.cornerAccuracy;
    if (b.precision < a.precision - 1e-9 || b.recall < a.recall - 1e-9)
      failed.push({
        name: row.name,
        criterion: "final-output corner precision/recall regression",
        before: a,
        after: b,
      });
  }
}
if (failed.length) {
  console.error(
    "Stage 1.5 promotion gate FAIL: keep experimental branch, do not merge main.",
  );
  console.error(JSON.stringify(failed, null, 2));
  process.exitCode = 1;
} else console.log("Stage 1.5 experimental geometry gates PASS; Auto remains unchanged.");
