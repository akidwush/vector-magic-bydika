// Alias only the existing WASM import; production adapter/Worker/UI remain intact.
import { build } from "vite";
import { resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
const root = resolve(process.env.NEXORA_ART_BUILDS);
for (const name of ["production", "geometry-f", "hotpath-h"]) {
  const dir = root + "/" + name;
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
  const manifest = JSON.parse(await readFile(dir + "/manifest.json"));
  manifest.appAliasOnly = true;
  await writeFile(dir + "/manifest.json", JSON.stringify(manifest, null, 2));
}
