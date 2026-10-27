// Isolated application aliases; changing a module's research mode is explicit in its manifest.
import { readFile, writeFile, mkdir, cp } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { build } from "vite";
import { execFileSync } from "node:child_process";
const root = resolve(process.env.NEXORA_THIN_BUILDS);
const sha = (b) => createHash("sha256").update(b).digest("hex");
const snapshot = JSON.parse(await readFile(root + "/source-manifest.json"));
for (const f of snapshot)
  if (sha(await readFile(f.file)) !== f.sha256)
    throw Error("Source changed during build " + f.file);
const variants = [
  ["baseline-auto", null],
  ["thin-observe", 0],
  ["thin-precision", 1],
  ["thin-thread", 2],
  ["thin-structural", 3],
  ["thin-negative", 4],
];
for (const [name, mode] of variants) {
  const dir = root + "/" + name;
  if (mode !== null) {
    await mkdir(dir);
    for (const file of ["nexora_wasm.js", "nexora_wasm_bg.wasm"])
      await cp(root + "/research/" + file, dir + "/" + file);
    let glue = await readFile(dir + "/nexora_wasm.js", "utf8");
    const end = "export { initSync, __wbg_init as default };";
    if (!glue.includes(end)) throw Error("Binding initializer changed");
    glue = glue.replace(
      end,
      `export { initSync }; export default async function thinInit(...args) {
        const core=await __wbg_init(...args);thin_research_configure(${mode},false);
        if (typeof WorkerGlobalScope!=='undefined' && globalThis instanceof WorkerGlobalScope && !globalThis.__nexoraThinPostInstalled) {
          const nativePost=globalThis.postMessage.bind(globalThis);globalThis.__nexoraThinPostInstalled=true;
          globalThis.postMessage=(message,...options)=>nativePost(message?.result?{...message,thinResearch:JSON.parse(last_region_survival())}:message,...options);
        }
        return core;
      }`,
    );
    await writeFile(dir + "/nexora_wasm.js", glue);
  }
  const manifest = {
    baseline: "ca3871e14ca633aad09503e78681631348d71b75",
    sourceCommit:
      mode === null
        ? "ca3871e14ca633aad09503e78681631348d71b75"
        : execFileSync("git", ["rev-parse", "HEAD"], {
            encoding: "utf8",
          }).trim(),
    features: mode === null ? [] : ["thin_feature_research"],
    mode,
    capture: false,
    wasmSHA256: sha(await readFile(dir + "/nexora_wasm_bg.wasm")),
    glueSHA256: sha(await readFile(dir + "/nexora_wasm.js")),
    workingPatchSHA256: sha(await readFile(root + "/working.patch")),
    sourceSnapshotSHA256: sha(await readFile(root + "/source-manifest.json")),
    policy:
      "Unchanged app controls/Worker. Isolated binding configures research mode and appends diagnostics to the existing result message after tracing; no extra messages, reference or filename enters the solver. Post-message diagnostic cost is outside traceMs.",
  };
  await writeFile(dir + "/manifest.json", JSON.stringify(manifest, null, 2));
  await build({
    configFile: resolve("vite.config.ts"),
    base: "/app/" + name + "/",
    resolve: {
      alias: [
        { find: "./wasm/nexora_wasm", replacement: dir + "/nexora_wasm.js" },
      ],
    },
    build: { outDir: dir + "/app", emptyOutDir: true },
  });
}
const configs = variants.map(([module, mode]) => ({
  id: mode === null ? "A-auto" : module,
  module,
  quality: "auto",
  optimize: true,
  sourceRefine: false,
}));
await writeFile(root + "/configs.json", JSON.stringify(configs, null, 2));
