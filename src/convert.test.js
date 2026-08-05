import { test } from "node:test";
import assert from "node:assert/strict";

import {
  convert,
  outputFilename,
  extensionOf,
  acceptString,
  ConversionError,
  SUPPORTED_EXTENSIONS,
} from "./convert.js";

test("converts a CSV to a Markdown table", async () => {
  const csv = Buffer.from("name,role\nAda,engineer\n");
  const result = await convert("people.csv", csv);
  assert.equal(result.filename, "people.md");
  assert.match(result.markdown, /Ada/);
  assert.match(result.markdown, /engineer/);
});

test("rejects an empty file", async () => {
  await assert.rejects(
    () => convert("empty.csv", Buffer.alloc(0)),
    (err) => err instanceof ConversionError && err.code === "empty_file",
  );
});

test("rejects a raw ZIP archive", async () => {
  await assert.rejects(
    () => convert("bundle.zip", Buffer.from("PK\x03\x04payload")),
    (err) => err.code === "zip_not_allowed",
  );
});

test("rejects a ZIP disguised under a non-container extension", async () => {
  await assert.rejects(
    () => convert("notes.csv", Buffer.from("PK\x03\x04payload")),
    (err) => err.code === "zip_not_allowed",
  );
});

test("rejects an unsupported extension", async () => {
  await assert.rejects(
    () => convert("photo.png", Buffer.from("whatever")),
    (err) => err.code === "unsupported_format",
  );
});

test("reports a clean error for a corrupt document", async () => {
  await assert.rejects(
    () => convert("broken.docx", Buffer.from("PK\x03\x04corrupt")),
    (err) => err.code === "failed",
  );
});

test("outputFilename swaps the extension for .md", () => {
  assert.equal(outputFilename("report.docx"), "report.md");
  assert.equal(outputFilename("/path/to/Deck.pptx"), "Deck.md");
  assert.equal(outputFilename("noext"), "noext.md");
});

test("extensionOf lowercases and isolates the extension", () => {
  assert.equal(extensionOf("Report.PDF"), ".pdf");
  assert.equal(extensionOf("archive.tar.gz"), ".gz");
  assert.equal(extensionOf("plain"), "");
});

test("acceptString lists every supported extension", () => {
  const accept = acceptString();
  for (const ext of SUPPORTED_EXTENSIONS) {
    assert.ok(accept.includes(ext), `accept string missing ${ext}`);
  }
});
