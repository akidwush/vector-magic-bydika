// Diagnostic app builds alias only the existing WASM import. App source untouched.
import { build } from "vite";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve(process.env.NEXORA_CROSS_ROOT);
for (const id of [
  "stage16f",
  "stage16h",
  "diagnostic-reference",
  "diagnostic-hotpath",
]) {
  const dir = root + "/" + id;
  const wrapper = await readFile(
    "scripts/runtime-cross-module.mjs.template",
    "utf8",
  );
  await writeFile(
    dir + "/instrumented-module.mjs",
    wrapper
      .replaceAll("__CORE__", JSON.stringify(dir + "/nexora_wasm.js"))
      .replaceAll("__BUILD_ID__", JSON.stringify(id)),
  );
  await build({
    configFile: resolve("vite.config.ts"),
    base: "/app/" + id + "/",
    resolve: {
      alias: [
        {
          find: "./wasm/nexora_wasm",
          replacement: dir + "/instrumented-module.mjs",
        },
      ],
    },
    build: { outDir: dir + "/app", emptyOutDir: true },
  });
}
