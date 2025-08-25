# Authord — Single-page Confluence Publisher

Flatten an **Authord** or **Writerside** docs project into **one Confluence (DC/Server)** page.
Validates the project, converts Markdown to Confluence **storage XHTML**, renders Mermaid diagrams to PNG attachments, and **uploads only when content changed** (delta via a page property hash).

---

## Highlights

* 🧭 **Deterministic ordering from config**

  * Writerside: uses `writerside.cfg` → referenced `*.tree` file (DFS).
  * Authord: uses `authord.config.json` `instances[*].toc-elements` (DFS).
  * Any orphan `.md` files (not present in any tree) are appended alphabetically at the end.
* 🧪 **Built-in validation**

  * Checks topics/images dirs, TOC references, broken links/images, and missing anchors.
* 🖼️ **Attachments handled**

  * Markdown images and Mermaid diagrams become Confluence attachments (`<ac:image><ri:attachment/></ac:image>`). Only missing ones are uploaded.
* ⚡ **Delta aware**

  * Skips publishing if the computed hash matches the remote page’s `exportHash` property.
* 🦕 **Deno-native CLI** (no Node build step required).

---

## Quick start (Deno)

#### Tasks quickstart

- Install deps for editors/CI: `deno task setup:deps`
- Type-check: `deno task check`
- Lint: `deno task lint`
- Format: `deno task fmt`
- Test: `deno task test`
- Build native binary: `deno task build`

```bash
deno run -A /path/to/authord/lib/cli.ts confluence-single \
  --base-url=https://<your-confluence-domain> \
  --basic-auth="<username>:<password-or-api-token>" \
  --page-id=<confluence-page-id> \
  /path/to/your/writerside

```

> The command detects the project type by the presence of **`writerside.cfg`** or **`authord.config.json`** in the provided directory, validates it, then publishes.

---

## Build

Compile to a native binary (no tasks required):

```bash
deno compile -A -o bin/authord ./cli.ts
```

*(Optional)* If you prefer `deno task build`, add this to your `deno.jsonc`:

```json
{
  "tasks": {
    "build": "deno compile -A -o bin/authord ./cli.ts",
    "check": "deno check ./cli.ts",
    "setup:deps": "deno cache ./cli.ts",
    "test": "deno test -A"
  }
}
```

--- 

## CLI

```
authord confluence-single [dir]

Arguments:
  [dir]                         Project root directory (default: ".")

Required:
  --base-url <url>              Confluence base URL
  --basic-auth <user:pass>      API token (Bearer or "user:pass" for Basic)
  -i, --page-id <id>            Existing Confluence page ID to update

Optional:
  --title <t>                   Page title (defaults to current page title)
  --md <dir>                    Topics directory (relative to [dir], default: topics)
  --images <dir>                Images directory (relative to [dir], default: images)
```

> **No `--space` flag.** The tool updates an existing page via `--page-id`; it does not create pages in this flow.

---

## Reset the delta hash (`exportHash`)

To force a re-publish, delete the page property:

```bash
curl -i -X DELETE \
  -H "Authorization: Bearer <TOKEN_BEARER>" \
  -H "X-Atlassian-Token: no-check" \
  "<CONFLUENCE_BASE_URL>/rest/api/content/<PAGE_ID>/property/exportHash"
```

---

## Project layout

### Writerside

```
writerside.cfg
<instance>.tree
topics/
images/
```

* `writerside.cfg` declares the topics/images dirs and references one or more `.tree` files.
* The `.tree` file defines **the exact order** the Markdown files are published (depth-first).

### Authord

```
authord.config.json
topics/
images/
```

* `authord.config.json` declares `topics`, `images`, and **instances** with `toc-elements`.
* `toc-elements` defines **the exact order** the Markdown files are published (depth-first).

> In both modes, any `.md` not listed in the configuration is appended alphabetically at the end.

---

## Markdown → Confluence specifics

* **Images**
  Standard images like `![alt](diagram.png)` become Confluence attachments.
  You can append size hints using a trailing attribute block:

  ```
  ![alt](diagram.png){width: 600; height: 400}
  ```

  Width/height accept values like `450` or `450px` (px is normalized away).
  Inline `<img>` tags are also supported.

* **Mermaid**
  Fenced blocks with `mermaid` are rendered to **PNG** and attached:

  ````
  ```mermaid
  graph LR
    A --> B
  ```
  ````

  Environment overrides recognized by the renderer:

  * `MMD_WIDTH`, `MMD_HEIGHT`, `MMD_SCALE`, `MMD_BG`
  * `MMD_THEME`, `MMD_CONFIG`
  * Work dir for diagram cache: `AUTHORD_WORK_DIR` (falls back to system temp)

* **Strike-through**
  Markdown `~~strike~~` is converted to an inline style compatible with Confluence Server/DC.

* **XHTML**
  Output is strict storage XHTML with Confluence XML namespaces and self-closed void tags.

---

## Validation (automatic before publish)

* Writerside: shape of `writerside.cfg` and referenced `.tree`; topics & images dirs.
* Authord: presence of `authord.config.json`; topics/images dirs; referenced TOC files.
* Markdown:

  * **Links:** internal file links resolve on disk
  * **Images:** file exists (also checks shared `images/` dir)
  * **Anchors:** intra-doc `#anchors` exist; cross-doc anchors validate the target file

On errors, the CLI prints a per-file list and exits non-zero.

---

## Confluence behavior

* **Requires an existing page** (`--page-id` is mandatory). The tool **updates** that page; it does not create new ones in this flow.
* **Versioning:** fetches current title/version, updates body with the next version number.
* **Delta check:** skips update when the page property `exportHash` matches the locally computed hash.
* **Attachments:** scans generated XHTML for filenames, compares with existing attachments, and uploads only missing files (handles duplicate filenames by falling back to the latest version).

---

## Requirements

* **Deno** installed (uses npm packages via Deno’s Node compatibility).
* **Confluence DC/Server** reachable with a token (Bearer) or Basic credentials (`user:pass`).
* **Mermaid CLI**

  * If `node_modules/.bin/mmdc` is not present, the tool will run `npx mmdc` automatically.
  * For offline/CI, install locally: `npm i -D @mermaid-js/mermaid-cli`.

> **Not included:** PlantUML support and debug env switches are **not present** in this build.

---

## Troubleshooting

* **“Cannot find module …/utils/…”** – Update the imports in `confluence-single.ts` and `publish-single.ts` to point at the repo-root files (remove `utils/`), or move the files into a `utils/` folder.
* **“No project config found …”** – ensure `writerside.cfg` or `authord.config.json` exists in the target directory.
* **Broken links/images** – check paths relative to the Markdown file or place shared assets under the configured `images` dir.
* **Mermaid fails in CI** – install `@mermaid-js/mermaid-cli` locally and ensure headless Chrome can launch (the CLI already uses a non-interactive mode).

---

## License

This project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.
