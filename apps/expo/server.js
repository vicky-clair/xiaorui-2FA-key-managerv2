const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = 3000;
const DIST_DIR = path.join(__dirname, "dist");

const mimeTypes = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".woff": "application/font-woff",
  ".ttf": "application/font-ttf",
  ".eot": "application/vnd.ms-fontobject",
  ".otf": "application/font-otf",
  ".wasm": "application/wasm",
};

function getSecurityHeaders(contentType) {
  return {
    "Content-Type": contentType,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self' 'wasm-unsafe-eval'",
      "worker-src 'self' blob:",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
    ].join("; "),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
}

function resolveStaticFile(rootDir, requestUrl) {
  const decodedPath = decodeURIComponent(requestUrl.split("?")[0]);
  const pathname = decodedPath === "/" ? "/index.html" : decodedPath;
  const root = path.resolve(rootDir);
  const resolved = path.resolve(root, `.${pathname}`);

  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return null;
  }

  return resolved;
}

const server = http.createServer((req, res) => {
  let filePath;
  try {
    filePath = resolveStaticFile(DIST_DIR, req.url || "/");
  } catch {
    res.writeHead(400);
    res.end("Bad Request");
    return;
  }

  if (!filePath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (!fs.existsSync(filePath)) {
    filePath = path.join(DIST_DIR, "index.html");
  }

  const extname = String(path.extname(filePath)).toLowerCase();
  const contentType = mimeTypes[extname] || "application/octet-stream";

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === "ENOENT") {
        res.writeHead(404);
        res.end("404 Not Found");
      } else {
        res.writeHead(500);
        res.end(`Sorry, check with the site admin for error: ${error.code} ..\n`);
      }
    } else {
      res.writeHead(200, getSecurityHeaders(contentType));
      res.end(content, "utf-8");
    }
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Web app serving at http://127.0.0.1:${PORT}`);
});
