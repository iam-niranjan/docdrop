# docdrop

**Drop a document. Get clean Markdown. No AI, no account, no history.**

docdrop is a small, self-contained web application. It embeds a drag-and-drop
browser interface and a JSON conversion endpoint over the Rust
[`@firecrawl/anydoc`](https://github.com/firecrawl/anydoc) engine, which turns
office documents into consistent GitHub-Flavored Markdown.

There is no private service, database, login, or AI dependency. Conversion runs
entirely in-process.

```text
Browser → Node web server → anydoc (Rust) engine → Markdown response
```

docdrop ships in two forms that share the same UI:

- **Server build** (`src/`, `public/`, `Dockerfile`) — a self-hostable Node app
  that runs anydoc server-side. Documented below.
- **Browser build** (`docs/`) — a fully static site that runs anydoc as
  WebAssembly in the browser, so files never leave the visitor's machine. It is
  deployed to GitHub Pages and needs no server. See
  [Browser build (GitHub Pages)](#browser-build-github-pages).

## Run

Requirements: Node.js 20 or newer.

```bash
git clone https://github.com/iam-niranjan/docdrop.git
cd docdrop
npm install
npm start
```

Then open [http://127.0.0.1:3000](http://127.0.0.1:3000).

Set `PORT` or `HOST` to change where it listens (default `127.0.0.1:3000`).

## Run with Docker

```bash
docker build -t docdrop .
docker run --rm --name docdrop \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --memory 512m --memory-swap 512m \
  --cpus 1 --pids-limit 100 \
  -p 127.0.0.1:3000:3000 \
  docdrop
```

For public deployment, place it behind an HTTPS reverse proxy or managed load
balancer with request-rate and concurrency limits.

## Browser build (GitHub Pages)

`docs/` is a fully static version of docdrop that runs the anydoc engine as
WebAssembly directly in the browser via
[`@firecrawl/anydoc-wasm`](https://www.npmjs.com/package/@firecrawl/anydoc-wasm).
There is no server and no upload — the document is converted on the visitor's own
machine. It is published to GitHub Pages by
[`.github/workflows/pages.yml`](.github/workflows/pages.yml) on every push to
`main`.

The ~6 MB WebAssembly binary is not committed; the workflow fetches it from npm
and drops it beside the page at deploy time. To build and preview it locally:

```bash
npm install --no-save @firecrawl/anydoc-wasm@0.1.5
cp node_modules/@firecrawl/anydoc-wasm/anydoc_wasm.js docs/
cp node_modules/@firecrawl/anydoc-wasm/anydoc_wasm_bg.wasm docs/
python3 -m http.server -d docs 8000   # then open http://127.0.0.1:8000
```

(The copied `anydoc_wasm*` files are gitignored.)

## Supported formats

| Category | Extensions |
| --- | --- |
| Word | `.doc`, `.docx`, `.docm` |
| PowerPoint | `.ppt`, `.pps`, `.pot`, `.pptx`, `.pptm`, `.ppsx`, `.ppsm` |
| Excel | `.xls`, `.xlsx`, `.xlsm`, `.xlsb` |
| OpenDocument | `.odt`, `.ods`, `.odp` |
| Rich Text Format | `.rtf` |
| EPUB | `.epub` |
| CSV | `.csv` |
| PDF | `.pdf` |

## How it works

The Node web server serves the embedded HTML, CSS, and JavaScript interface and
exposes a single conversion endpoint:

- `POST /api/convert` — multipart upload with one `file` field; responds with
  `{ "markdown": "…", "filename": "name.md" }`.
- `GET /api/health` — returns `{ "status": "ok" }`.

anydoc detects the format from the file's content markers (not just its
extension), so mislabeled files still convert correctly. For markerless formats
such as CSV, docdrop falls back to the file extension. Every format is rendered
through anydoc's single Markdown serializer for consistent headings, tables,
lists, and footnotes.

Uploaded files are processed in bounded memory for the current request. The
application does not create a conversion history or store uploaded documents.

## Save AI tokens with Markdown

Before giving a PDF, Word document, or presentation to an AI assistant, convert
it to Markdown and provide the `.md` file. Markdown preserves useful structure
without much of the presentation and layout noise in office-document formats.
This can reduce unnecessary input tokens and lets you remove irrelevant sections
first. docdrop itself does not use AI.

## Privacy and security

- No login, database, cookies, analytics, telemetry, AI, or external converter
  calls.
- Uploads are limited to 20 MB and held in memory only for the current request.
- Raw ZIP archives are rejected outright, including a disguised ZIP uploaded
  under another file extension.
- File extensions are allowlisted, and each conversion is bounded by a timeout.
- Every response sets a strict Content-Security-Policy and related hardening
  headers, and `POST /api/convert` rejects cross-origin requests.
- Filenames and document contents are not written to application logs.

## Tests

```bash
node --test
docker build --target test -t docdrop-tests .
docker build -t docdrop .
```

## Project layout

```text
src/server.js    Node HTTP server, static UI, and the /api/convert endpoint
src/convert.js   anydoc wrapper: upload limits, format gating, timeout
public/          Server build's browser interface (HTML, CSS, JS)
Dockerfile       Multi-stage build with a test stage and runtime image
docs/            Static browser build (anydoc-wasm) deployed to GitHub Pages
.github/         Pages deploy workflow
```

## Credits

Conversion is powered by [`@firecrawl/anydoc`](https://github.com/firecrawl/anydoc)
(MIT).

## License

docdrop is released under the [MIT License](LICENSE). Third-party dependencies
retain their own licenses.
