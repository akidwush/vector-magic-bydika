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
}).listen(4173, "127.0.0.1");
