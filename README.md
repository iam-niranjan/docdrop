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
public/          Embedded browser interface (HTML, CSS, JS)
Dockerfile       Multi-stage build with a test stage and runtime image
```

## Credits

Conversion is powered by [`@firecrawl/anydoc`](https://github.com/firecrawl/anydoc)
(MIT).

## License

docdrop is released under the [MIT License](LICENSE). Third-party dependencies
retain their own licenses.
