import { existsSync, readFileSync, statSync } from "node:fs";

const required = [
  "README.md",
  "AGENTS.md",
  "docs/00_PROJECT_CHARTER.md",
  "docs/01_UPSTREAM_RESEARCH.md",
  "docs/02_ARCHITECTURE.md",
  "docs/03_QUALITY_AND_TEST_PLAN.md",
  "docs/04_ROADMAP.md",
  "docs/STAGE_01_HANDOFF.md",
  "docs/DEPLOY_GITLAB_PAGES.md",
  ".gitlab-ci.yml",
  "landing/index.html",
  "landing/styles.css",
];

let failures = 0;
for (const file of required) {
  if (
    !existsSync(file) ||
    !statSync(file).isFile() ||
    statSync(file).size < 20
  ) {
    console.error("Missing or empty required file:", file);
    failures += 1;
  }
}

if (failures === 0) {
  const html = readFileSync("landing/index.html", "utf8");
  if (!html.includes("<!doctype html>") || !html.includes("Tahap 0")) {
    console.error(
      "Landing page must explicitly disclose Stage 0 placeholder state.",
    );
    failures += 1;
  }
}

if (failures > 0) {
  console.error("Stage 0 validation failed:", failures, "issue(s)");
  process.exitCode = 1;
} else {
  console.log("Stage 0 validation passed. This does NOT test image tracing.");
}
