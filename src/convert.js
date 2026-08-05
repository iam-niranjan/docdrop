// Document → Markdown conversion, powered by the Rust @firecrawl/anydoc engine.
//
// anydoc detects the format from the file's content markers (not its extension)
// and renders every format through a single GitHub-Flavored Markdown serializer.
// This module wraps that engine with the same guardrails the web server relies
// on: an upload ceiling, an extension allowlist, a raw-ZIP guard, and a bound on
// how long any single conversion may run.

import {
  toMarkdownBytes,
  formatFromBytes,
  formatFromExtension,
} from "@firecrawl/anydoc";

const ADVERTISED_UPLOAD_MEGABYTES = 20;

// The UI advertises a 20 MB ceiling, but the server enforces a hard 25 MB cap.
// The gap lets a file that reads slightly above the advertised size still
// convert, while genuinely large uploads are rejected before they can freeze
// the request or the browser while rendering the result.
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

// Bounds a single conversion. anydoc is fast (median < 5 ms), so a file that
// runs long is almost certainly damaged or hostile; fail it with a clean error
// rather than tying up the request.
const CONVERSION_TIMEOUT_MS = 60_000;

// Formats @firecrawl/anydoc can parse. Content-based detection still runs inside
// the engine; this list is the friendly gate that rejects obviously unsupported
// uploads before they reach it.
export const SUPPORTED_EXTENSIONS = [
  ".csv",
  ".doc", ".docm", ".docx",
  ".epub",
  ".odp", ".ods", ".odt",
  ".pdf",
  ".pot", ".pps", ".ppsm", ".ppsx", ".ppt", ".pptm", ".pptx",
  ".rtf",
  ".xls", ".xlsb", ".xlsm", ".xlsx",
];

// Formats that are themselves ZIP containers with a fixed internal structure.
// They are exempt from the raw-ZIP sniff below.
const ZIP_CONTAINER_EXTENSIONS = new Set([
  ".docx", ".docm", ".pptx", ".pptm", ".ppsx", ".ppsm", ".xlsx", ".xlsm", ".xlsb",
  ".odt", ".ods", ".odp", ".epub",
]);

const ZIP_MAGIC_PREFIXES = [
  Buffer.from("PK\x03\x04", "binary"),
  Buffer.from("PK\x05\x06", "binary"),
  Buffer.from("PK\x07\x08", "binary"),
];

export class ConversionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ConversionError";
    this.code = code;
  }
}

export const ERRORS = {
  EMPTY_FILE: () => new ConversionError("empty_file", "That file is empty."),
  FILE_TOO_LARGE: () =>
    new ConversionError(
      "file_too_large",
      `File exceeds the ${ADVERTISED_UPLOAD_MEGABYTES} MB limit.`,
    ),
  UNSUPPORTED_FORMAT: () =>
    new ConversionError(
      "unsupported_format",
      "That file type is not supported yet.",
    ),
  ZIP_NOT_ALLOWED: () =>
    new ConversionError(
      "zip_not_allowed",
      "ZIP archives aren't supported. Unzip the archive and upload the individual files instead.",
    ),
  TIMEOUT: () =>
    new ConversionError("timeout", "That file took too long to convert."),
  FAILED: () =>
    new ConversionError(
      "failed",
      "This file could not be converted. It may be damaged, encrypted, or use an unsupported feature.",
    ),
};

export function extensionOf(filename) {
  const base = filename.split(/[\\/]/).pop() || "";
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot).toLowerCase();
}

export function outputFilename(input) {
  const base = (input.split(/[\\/]/).pop() || "").trim();
  const ext = extensionOf(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  return `${stem || "converted"}.md`;
}

export function acceptString() {
  return SUPPORTED_EXTENSIONS.join(",");
}

function looksLikeZip(buffer) {
  return ZIP_MAGIC_PREFIXES.some((prefix) =>
    buffer.subarray(0, prefix.length).equals(prefix),
  );
}

// Convert an uploaded file to Markdown. Throws a ConversionError with a stable
// `code` on any rejection so the server can map it to an HTTP status.
export async function convert(filename, data) {
  if (!data || data.length === 0) throw ERRORS.EMPTY_FILE();
  if (data.length > MAX_UPLOAD_BYTES) throw ERRORS.FILE_TOO_LARGE();

  const ext = extensionOf(filename);
  if (ext === ".zip") throw ERRORS.ZIP_NOT_ALLOWED();
  if (!SUPPORTED_EXTENSIONS.includes(ext)) throw ERRORS.UNSUPPORTED_FORMAT();
  if (!ZIP_CONTAINER_EXTENSIONS.has(ext) && looksLikeZip(data)) {
    throw ERRORS.ZIP_NOT_ALLOWED();
  }

  // Prefer anydoc's content-based detection so mislabeled files still convert
  // correctly, but fall back to the extension for markerless formats (CSV, RTF,
  // plain text) that content sniffing can't identify.
  const format = formatFromBytes(data) ?? formatFromExtension(ext);
  if (!format) throw ERRORS.UNSUPPORTED_FORMAT();

  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(ERRORS.TIMEOUT()), CONVERSION_TIMEOUT_MS);
  });

  try {
    const markdown = await Promise.race([toMarkdownBytes(data, format), timeout]);
    return {
      markdown: typeof markdown === "string" ? markdown : String(markdown ?? ""),
      filename: outputFilename(filename),
    };
  } catch (err) {
    if (err instanceof ConversionError) throw err;
    throw ERRORS.FAILED();
  } finally {
    clearTimeout(timer);
  }
}
