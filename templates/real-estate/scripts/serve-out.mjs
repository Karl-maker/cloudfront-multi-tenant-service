import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../out", import.meta.url));
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";

const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

function resolvePath(url) {
  const requested = decodeURIComponent(new URL(url, "http://localhost").pathname);
  const clean = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const candidates = [
    join(root, clean),
    join(root, clean, "index.html"),
    join(root, `${clean}.html`)
  ];

  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

createServer((request, response) => {
  const file = resolvePath(request.url || "/") || join(root, "404.html");
  const status = file.endsWith("404.html") ? 404 : 200;
  response.writeHead(status, {
    "content-type": types[extname(file)] || "application/octet-stream"
  });
  createReadStream(file).pipe(response);
}).listen(port, host, () => {
  console.log(`Serving static export from ${root}`);
  console.log(`http://${host}:${port}`);
});
