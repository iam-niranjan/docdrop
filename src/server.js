#!/usr/bin/env node
// docdrop — an embedded web UI and JSON endpoint over the @firecrawl/anydoc
// conversion engine.
//
//   Browser → Node web server → anydoc (Rust) engine → Markdown response
//
// Uploaded files are held in memory only for the life of the request. There is
// no database, no conversion history, and no external service call.

import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize } from "node:path";
import Busboy from "busboy";

import {
  convert,
  ConversionError,
  MAX_UPLOAD_BYTES,
  ERRORS,
} from "./convert.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const STATUS_FOR_CODE = {
  empty_file: 422,
  file_too_large: 413,
  unsupported_format: 415,
  zip_not_allowed: 415,
  timeout: 504,
  failed: 422,
};

function securityHeaders(res) {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
}

function sendJSON(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function sendError(res, status, message) {
  sendJSON(res, status, { error: message });
}

// Reject cross-origin POSTs. GETs (static assets) are unaffected.
function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers.host || "";
  return (
    origin.toLowerCase() === `http://${host}`.toLowerCase() ||
    origin.toLowerCase() === `https://${host}`.toLowerCase()
  );
}

// Read a single "file" field from a multipart body into a bounded buffer.
function readUpload(req) {
  return new Promise((resolve, reject) => {
    let busboy;
    try {
      busboy = Busboy({
        headers: req.headers,
        limits: { files: 1, fileSize: MAX_UPLOAD_BYTES + 1 },
      });
    } catch {
      reject(new ConversionError("bad_request", "Send one file as multipart form data."));
      return;
    }

    let filename = "";
    let tooLarge = false;
    const chunks = [];
    let handled = false;

    busboy.on("file", (name, stream, info) => {
      if (name !== "file" || !info.filename) {
        stream.resume();
        return;
      }
      handled = true;
      filename = info.filename;
      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("limit", () => {
        tooLarge = true;
      });
    });

    busboy.on("error", () =>
      reject(new ConversionError("bad_request", "The file could not be read.")),
    );
    busboy.on("close", () => {
      if (!handled) {
        reject(new ConversionError("bad_request", "Choose a file to convert."));
        return;
      }
      if (tooLarge) {
        reject(ERRORS.FILE_TOO_LARGE());
        return;
      }
      resolve({ filename, data: Buffer.concat(chunks) });
    });

    req.pipe(busboy);
  });
}

async function handleConvert(req, res) {
  if (!isSameOrigin(req)) {
    sendError(res, 403, "Cross-origin requests are not allowed.");
    return;
  }

  let upload;
  try {
    upload = await readUpload(req);
  } catch (err) {
    const status = err instanceof ConversionError && err.code === "file_too_large" ? 413 : 400;
    sendError(res, status, err.message);
    return;
  }

  try {
    const result = await convert(upload.filename, upload.data);
    res.setHeader("Cache-Control", "no-store");
    sendJSON(res, 200, result);
  } catch (err) {
    if (err instanceof ConversionError) {
      sendError(res, STATUS_FOR_CODE[err.code] || 422, err.message);
      return;
    }
    sendError(res, 422, ERRORS.FAILED().message);
  }
}

async function serveStatic(req, res) {
  let pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (pathname === "/") pathname = "/index.html";

  // Confine every request to PUBLIC_DIR — no path traversal out of it.
  const filePath = normalize(join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendError(res, 403, "Forbidden.");
    return;
  }

  try {
    const body = await readFile(filePath);
    const ext = filePath.slice(filePath.lastIndexOf("."));
    res.writeHead(200, {
      "Content-Type": CONTENT_TYPES[ext] || "application/octet-stream",
    });
    res.end(body);
  } catch {
    sendError(res, 404, "Not found.");
  }
}

const server = http.createServer((req, res) => {
  securityHeaders(res);

  if (req.method === "POST" && req.url === "/api/convert") {
    handleConvert(req, res);
    return;
  }
  if (req.method === "GET" && req.url === "/api/health") {
    sendJSON(res, 200, { status: "ok" });
    return;
  }
  if (req.method === "GET" || req.method === "HEAD") {
    serveStatic(req, res);
    return;
  }

  sendError(res, 405, "Method not allowed.");
});

server.headersTimeout = 10_000;
server.requestTimeout = 90_000;

server.listen(PORT, HOST, () => {
  console.log(`docdrop listening on http://${HOST}:${PORT}`);
});
