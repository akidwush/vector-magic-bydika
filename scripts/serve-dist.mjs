// Test-only static server: deliberately supports a project subpath, not SPA fallbacks.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
const root = resolve("dist"),
  prefix = "/nexora/";
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".txt": "text/plain",
};
createServer(async (req, res) => {
  if (process.env.NEXORA_RESEARCH === "1" && req.url.startsWith("/research/")) {
    const name = req.url.slice(10);
    const file =
      name === "imagetracer.js"
        ? "node_modules/imagetracerjs/imagetracer_v1.2.6.js"
        : ["nexora_wasm.js", "nexora_wasm_bg.wasm"].includes(name)
          ? "benchmark-results/quality/wasm/" + name
          : null;
    if (!file) {
      res.writeHead(404).end();
      return;
    }
    try {
      res.writeHead(200, {
        "Content-Type": name.endsWith(".wasm")
          ? "application/wasm"
          : "text/javascript",
      });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404).end();
    }
    return;
  }
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (!pathname.startsWith(prefix)) {
    res.writeHead(404).end();
    return;
  }
  const path = resolve(
    root,
    decodeURIComponent(pathname.slice(prefix.length) || "index.html"),
  );
  if (!path.startsWith(root + "/")) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(path);
    res.writeHead(200, {
      "Content-Type": types[extname(path)] ?? "application/octet-stream",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(Number(process.env.NEXORA_PORT || 4173), "127.0.0.1");
