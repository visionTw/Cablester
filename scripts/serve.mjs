import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { mediaAssetRelativePath } from "../src/asset-paths.js";

const root = process.cwd();
const port = Number(process.env.CABLESTER_PORT || 4173);
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".avif": "image/avif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml"
};

const server = createServer((request, response) => {
  const rawPath = (request.url || "/").split("?")[0];
  const requestedMedia = /^\/media\//i.test(rawPath);
  const rawMediaRelativePath = mediaAssetRelativePath(rawPath);
  if (requestedMedia && !rawMediaRelativePath) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  let requestPath;
  try {
    requestPath = decodeURIComponent(rawPath);
  } catch {
    response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    response.end("Invalid URL encoding");
    return;
  }
  const assetPath = rawMediaRelativePath ? `/assets/${rawMediaRelativePath}` : requestPath;
  const relativePath = assetPath === "/" ? "index.html" : assetPath.slice(1);
  const safePath = normalize(relativePath).replace(/^(\.\.[/\\])+/, "");
  let filePath = join(root, safePath);

  if (!filePath.startsWith(root) || !existsSync(filePath)) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  if (statSync(filePath).isDirectory()) {
    filePath = join(filePath, "index.html");
  }

  response.writeHead(200, {
    "cache-control": requestPath.startsWith("/assets/") || requestPath.startsWith("/media/")
      ? "public, max-age=3600, must-revalidate"
      : "no-store",
    "content-type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream"
  });
  createReadStream(filePath).pipe(response);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Cablester prototype: http://127.0.0.1:${port}`);
});
