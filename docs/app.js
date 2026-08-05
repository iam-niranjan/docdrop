// Client-side document → Markdown conversion. The Rust @firecrawl/anydoc engine
// runs entirely in the browser as WebAssembly, so uploaded files never leave the
// user's machine. This mirrors the guardrails in the server build's
// src/convert.js: an upload ceiling, an extension allowlist, a raw-ZIP guard, and
// content-based format detection with an extension fallback.
import init, {
  toMarkdownBytes,
  formatFromBytes,
  formatFromExtension,
} from "./anydoc_wasm.js";

const ADVERTISED_UPLOAD_MEGABYTES = 20;
// The UI advertises 20 MB; allow a little slack so a file that reads slightly
// above the advertised size still converts, while genuinely large uploads fail
// fast instead of freezing the tab.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const SUPPORTED_EXTENSIONS = new Set([
  ".csv",
  ".doc", ".docm", ".docx",
  ".epub",
  ".odp", ".ods", ".odt",
  ".pdf",
  ".pot", ".pps", ".ppsm", ".ppsx", ".ppt", ".pptm", ".pptx",
  ".rtf",
  ".xls", ".xlsb", ".xlsm", ".xlsx",
]);

// Formats that are themselves ZIP containers with a fixed internal structure.
// They are exempt from the raw-ZIP sniff.
const ZIP_CONTAINER_EXTENSIONS = new Set([
  ".docx", ".docm", ".pptx", ".pptm", ".ppsx", ".ppsm", ".xlsx", ".xlsm", ".xlsb",
  ".odt", ".ods", ".odp", ".epub",
]);

const ZIP_MAGIC = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08],
];

const dropZone = document.querySelector("#drop-zone");
const fileInput = document.querySelector("#file-input");
const processing = document.querySelector("#processing");
const processingStatus = document.querySelector("#processing-status");
const errorBox = document.querySelector("#error-box");
const result = document.querySelector("#result");
const output = document.querySelector("#markdown-output");
const copyButton = document.querySelector("#copy");
const downloadButton = document.querySelector("#download");
let outputFilename = "converted.md";

// Load the wasm engine once, on first need. Kicked off eagerly below so the
// ~6 MB module is usually ready by the time a file is dropped.
let enginePromise = null;
function loadEngine() {
  if (!enginePromise) enginePromise = init();
  return enginePromise;
}

function showOnly(element) {
  [dropZone, processing, errorBox, result].forEach((item) => { item.hidden = item !== element; });
}

function reset() {
  fileInput.value = "";
  output.value = "";
  showOnly(dropZone);
  dropZone.focus();
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function extensionOf(name) {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

function looksLikeZip(bytes) {
  return ZIP_MAGIC.some((magic) => magic.every((byte, i) => bytes[i] === byte));
}

function fail(message) {
  const err = new Error(message);
  err.handled = true;
  return err;
}

async function convert(file) {
  if (!file) return;
  const ext = extensionOf(file.name);
  document.querySelector("#processing-name").textContent = file.name;
  document.querySelector("#processing-ext").textContent = (file.name.split(".").pop() || "FILE").slice(0, 5).toUpperCase();
  processingStatus.textContent = enginePromise ? "Converting…" : "Loading converter…";
  showOnly(processing);

  try {
    if (file.size === 0) throw fail("That file is empty.");
    if (file.size > MAX_UPLOAD_BYTES) throw fail(`File exceeds the ${ADVERTISED_UPLOAD_MEGABYTES} MB limit.`);
    if (ext === ".zip") throw fail("ZIP archives aren’t supported. Unzip the archive and convert the individual files instead.");
    if (!SUPPORTED_EXTENSIONS.has(ext)) throw fail("That file type is not supported yet.");

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!ZIP_CONTAINER_EXTENSIONS.has(ext) && looksLikeZip(bytes)) {
      throw fail("ZIP archives aren’t supported. Unzip the archive and convert the individual files instead.");
    }

    await loadEngine();
    processingStatus.textContent = "Converting…";

    // Prefer anydoc's content-based detection so mislabeled files still convert;
    // fall back to the extension for markerless formats (CSV, RTF).
    const format = formatFromBytes(bytes) ?? formatFromExtension(ext);
    if (!format) throw fail("That file type is not supported yet.");

    const markdown = toMarkdownBytes(bytes, format);
    output.value = typeof markdown === "string" ? markdown : String(markdown ?? "");
    outputFilename = `${file.name.slice(0, ext ? -ext.length : undefined) || "converted"}.md`;

    document.querySelector("#result-name").textContent = outputFilename;
    const words = output.value.trim() ? output.value.trim().split(/\s+/).length : 0;
    document.querySelector("#result-meta").textContent = `${formatBytes(new Blob([output.value]).size)} · ${words.toLocaleString()} words`;
    showOnly(result);
    output.focus();
  } catch (error) {
    document.querySelector("#error-message").textContent = error.handled
      ? error.message
      : "This file could not be converted. It may be damaged, encrypted, or use an unsupported feature.";
    showOnly(errorBox);
  }
}

dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") { event.preventDefault(); fileInput.click(); }
});
fileInput.addEventListener("change", () => convert(fileInput.files[0]));

["dragenter", "dragover"].forEach((name) => dropZone.addEventListener(name, (event) => {
  event.preventDefault();
  dropZone.classList.add("dragging");
}));
["dragleave", "drop"].forEach((name) => dropZone.addEventListener(name, (event) => {
  event.preventDefault();
  dropZone.classList.remove("dragging");
}));
dropZone.addEventListener("drop", (event) => convert(event.dataTransfer.files[0]));

document.querySelector("#try-again").addEventListener("click", reset);
document.querySelector("#reset").addEventListener("click", reset);

copyButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(output.value);
  copyButton.textContent = "Copied";
  setTimeout(() => { copyButton.textContent = "Copy Markdown"; }, 1600);
});

downloadButton.addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([output.value], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = outputFilename;
  link.click();
  URL.revokeObjectURL(url);
});

// Warm the engine so the first conversion doesn't wait on the download.
loadEngine();
