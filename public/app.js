const dropZone = document.querySelector("#drop-zone");
const fileInput = document.querySelector("#file-input");
const processing = document.querySelector("#processing");
const errorBox = document.querySelector("#error-box");
const result = document.querySelector("#result");
const output = document.querySelector("#markdown-output");
const copyButton = document.querySelector("#copy");
const downloadButton = document.querySelector("#download");
let outputFilename = "converted.md";

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

async function convert(file) {
  if (!file) return;
  document.querySelector("#processing-name").textContent = file.name;
  document.querySelector("#processing-ext").textContent = (file.name.split(".").pop() || "FILE").slice(0, 5).toUpperCase();
  showOnly(processing);

  const form = new FormData();
  form.append("file", file);

  try {
    const response = await fetch("/api/convert", { method: "POST", body: form });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "The converter is unavailable.");

    output.value = payload.markdown || "";
    outputFilename = payload.filename || "converted.md";
    document.querySelector("#result-name").textContent = outputFilename;
    const words = output.value.trim() ? output.value.trim().split(/\s+/).length : 0;
    document.querySelector("#result-meta").textContent = `${formatBytes(new Blob([output.value]).size)} · ${words.toLocaleString()} words`;
    showOnly(result);
    output.focus();
  } catch (error) {
    document.querySelector("#error-message").textContent = error.message;
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
