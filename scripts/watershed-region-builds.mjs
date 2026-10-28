// Isolated unchanged UI, adapters and Worker; explicit per-module research mode.
import { readFile, writeFile, mkdir, cp } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { build } from "vite";
const root = resolve(process.env.NEXORA_WATERSHED_BUILDS),
  sha = (b) => createHash("sha256").update(b).digest("hex");
const variants = [
  ["baseline", null],
  ["observe", 0],
  ["mosaic", 1],
  ["watershed", 2],
  ["combined", 3],
];
for (const [name, mode] of variants) {
  const dir = root + "/" + name;
  if (mode !== null) {
    await mkdir(dir);
    for (const f of ["nexora_wasm.js", "nexora_wasm_bg.wasm"])
      await cp(root + "/research/" + f, dir + "/" + f);
    let glue = await readFile(dir + "/nexora_wasm.js", "utf8"),
      end = "export { initSync, __wbg_init as default };";
    if (!glue.includes(end)) throw Error("glue changed");
    glue = glue.replace(
      end,
      `export {initSync};export default async function regionInit(...args){const core=await __wbg_init(...args);watershed_research_configure(${mode});thin_research_configure(0,false);
if(typeof WorkerGlobalScope!=='undefined'&&globalThis instanceof WorkerGlobalScope&&!globalThis.__regionPost){globalThis.__regionPost=true;const native=globalThis.postMessage.bind(globalThis);globalThis.postMessage=(m,...opts)=>native(m?.result?{...m,thinResearch:{...JSON.parse(last_region_survival()),watershed:JSON.parse(last_watershed_regions())}}:m,...opts);}return core;}`,
    );
    await writeFile(dir + "/nexora_wasm.js", glue);
  }
  const m = {
    baseline: "ad770ad49b6168a75c1751bfbed412aad824fc15",
    sourceCommit:
      mode === null
        ? "ad770ad49b6168a75c1751bfbed412aad824fc15"
        : execFileSync("git", ["rev-parse", "HEAD"], {
            encoding: "utf8",
          }).trim(),
    features: mode === null ? [] : ["watershed_region_research"],
    mode,
    capture: false,
    wasmSHA256: sha(await readFile(dir + "/nexora_wasm_bg.wasm")),
    glueSHA256: sha(await readFile(dir + "/nexora_wasm.js")),
    workingPatchSHA256: sha(await readFile(root + "/working.patch")),
  };
  await writeFile(dir + "/manifest.json", JSON.stringify(m, null, 2));
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
await writeFile(
  root + "/configs.json",
  JSON.stringify(
    variants.map(([module]) => ({
      id: module === "baseline" ? "A-auto" : module,
      module,
      quality: "auto",
      optimize: true,
      sourceRefine: false,
    })),
    null,
    2,
  ),
);
