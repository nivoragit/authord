// Core use case: publish a single flattened document to Confluence.
// - Validates inputs & directories (via IFileSystem)
// - Sets image directory for downstream helpers
// - Resolves ordered Markdown paths (IOrderingResolver)
// - Concatenates, transforms to Storage XHTML (IMarkdownTransformer)
// - Computes SHA-256 delta hash (idempotency)
// - If no change: heal missing attachments only
// - Else: update page, ensure attachments, set export hash
//
// Side-effects happen only through injected ports.
//
// NOTE: Dependencies are injected via setPublishDeps() for testability.

import * as path from "node:path";
import { setImageDir } from "./utils/images.ts";
// Import the Mermaid renderer helper so we can materialize diagram PNGs
import { renderMermaidDefinitionToFile } from "./utils/mermaid.ts";
import {
  asPath,
  type PageId,
  type PublishSingleOptions,
  type StorageXhtml,
} from "./utils/types.ts";
import type {
  IAttachmentRepository,
  IFileSystem,
  IMarkdownTransformer,
  IOrderingResolver,
  IPageRepository,
  IPropertyStore,
} from "./ports/ports.ts";
import { makeExportHash } from "./domain/entities.ts";

/** Internal DI for the use case */
export interface PublishDeps {
  fs: IFileSystem;
  ordering: IOrderingResolver;
  transformer: IMarkdownTransformer;
  pageRepo: IPageRepository;
  attachRepo: IAttachmentRepository;
  props: IPropertyStore;
}

let DEPS: PublishDeps | null = null;

/** Inject dependencies for the use case (tests/adapters should call this once). */
export function setPublishDeps(deps: PublishDeps) {
  DEPS = deps;
}

/** Compute SHA-256 hex (lowercase) */
async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  const bytes = new Uint8Array(buf);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Extract unique ri:filename values from Confluence Storage XHTML */
function extractAttachmentFilenames(storage: string): string[] {
  const re = /ri:filename="([^"]+)"/g;
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(storage))) {
    const fn = m[1].trim();
    if (fn && !seen.has(fn)) {
      seen.add(fn);
      out.push(fn);
    }
  }
  return out;
}

/** Read all files (in order) via IFileSystem and concatenate with blank line between. */
async function readAndConcat(fs: IFileSystem, files: readonly string[]): Promise<string> {
  const parts: string[] = [];
  for (const f of files) {
    const txt = await fs.readText(asPath(f)); // brand to Path
    parts.push(txt);
  }
  return parts.join("\n\n");
}

/** Build the final ordered list, ensuring the explicit entrypoint appears first if necessary. */
function prioritizeEntrypoint(entry: string, ordered: readonly string[]): string[] {
  const set = new Set(ordered);
  const out: string[] = [];
  if (set.has(entry)) {
    out.push(entry);
    for (const p of ordered) if (p !== entry) out.push(p);
  } else {
    out.push(entry, ...ordered);
  }
  // Deduplicate (if entry also appears)
  const seen = new Set<string>();
  return out.filter((p) => (seen.has(p) ? false : (seen.add(p), true)));
}

/** Publish the single page according to the options, using injected ports. */
export async function publishSingle(options: PublishSingleOptions): Promise<void> {
  if (!DEPS) throw new Error("publishSingle deps not set. Call setPublishDeps(...) first.");

  const { fs, ordering, transformer, pageRepo, attachRepo, props } = DEPS;

  // ---- Validate options & directories
  if (!options.rootDir) throw new Error("rootDir is required");
  if (!options.md) throw new Error("md (entry markdown file) is required");
  if (!options.images) throw new Error("images directory is required");
  if (!options.baseUrl) throw new Error("baseUrl is required");
  if (!options.basicAuth?.username || !options.basicAuth?.password) {
    throw new Error("basicAuth.username/password are required");
  }
  if (!options.pageId) throw new Error("pageId is required");

  const rootDir = options.rootDir as unknown as string;
  const mdEntrypoint = options.md as unknown as string;
  const imagesDir = options.images as unknown as string;
  const pageId: PageId = options.pageId;

  if (!(await fs.exists(asPath(rootDir)))) throw new Error(`rootDir does not exist: ${rootDir}`);
  if (!(await fs.exists(asPath(imagesDir)))) throw new Error(`images dir does not exist: ${imagesDir}`);
  if (!(await fs.exists(asPath(mdEntrypoint)))) throw new Error(`entry markdown not found: ${mdEntrypoint}`);

  // Configure global image directory for helpers/adapters
  setImageDir(imagesDir);

  // ---- Resolve MD order
  const primaryOrder = await ordering.resolve(asPath(rootDir));
  const ordered = prioritizeEntrypoint(
    path.resolve(mdEntrypoint),
    (primaryOrder as readonly string[]).map((p) => path.resolve(p)),
  );

  // Filter to .md that exist (via fs)
  const filtered: string[] = [];
  for (const pth of ordered) {
    if (pth.toLowerCase().endsWith(".md") && (await fs.exists(asPath(pth)))) filtered.push(pth);
  }
  if (filtered.length === 0) {
    throw new Error("No markdown files to publish after resolution.");
  }

  // ---- Read & transform
  const markdown = await readAndConcat(fs, filtered);

  // Before transforming to storage XHTML, proactively render any Mermaid diagrams
  // found in the concatenated Markdown. Writerside's remark plugin produces
  // deterministic placeholder filenames of the form "mermaid-<n>.png" where n
  // increments in the order diagrams are encountered across the entire input.
  // Without creating these PNG files ahead of time, the subsequent attachment
  // healing step would fail to find the files on disk, leaving broken image
  // references in the published Confluence page. By scanning the raw
  // concatenated Markdown here and invoking the Mermaid CLI via
  // renderMermaidDefinitionToFile(), we ensure all referenced PNGs exist
  // in the images directory before converting the Markdown to XHTML.
  {
    const mermaidRegex = /```mermaid\s*\n([\s\S]*?)```/g;
    let match: RegExpExecArray | null;
    let mermaidIndex = 1;
    while ((match = mermaidRegex.exec(markdown))) {
      const def = (match[1] || "").trim();
      if (!def) {
        mermaidIndex += 1;
        continue;
      }
      try {
        const outName = `mermaid-${mermaidIndex}.png`;
        const outPath = path.resolve(imagesDir, outName);
        // Render the diagram; any errors are caught and reported but do not
        // prevent publication. renderMermaidDefinitionToFile() will create
        // the output directory if needed.
        await renderMermaidDefinitionToFile(def, outPath);
      } catch (err) {
        console.warn(
          `[authord] Failed to render Mermaid diagram #${mermaidIndex}: ${err instanceof Error ? err.message : err}`,
        );
      } finally {
        mermaidIndex += 1;
      }
    }
  }

  const storage: StorageXhtml = await transformer.toStorage(markdown);

  // ---- Compute delta hash
  const newHash = await sha256Hex(String(storage));

  // ---- Fetch current property
  const currentHash = await props.getExportHash(pageId);

  // ---- Ensure attachments present (helper)
  async function ensureRequiredAttachments(s: StorageXhtml): Promise<number> {
    const required = extractAttachmentFilenames(String(s));
    if (required.length === 0) return 0;

    // what is already on the page?
    const existing = await attachRepo.list(pageId);
    const have = new Set(existing.map((e) => e.fileName));

    let uploaded = 0;
    for (const fn of required) {
      if (!have.has(fn)) {
        const abs = path.resolve(imagesDir, fn);
        if (await fs.exists(asPath(abs))) {
          await attachRepo.ensure(pageId, asPath(abs), "image/png");
          uploaded += 1;
        } else {
          console.warn(`[authord] missing local image file, skipping: ${abs}`);
        }
      }
    }
    return uploaded;
  }

  if (currentHash === newHash) {
    // No content change — heal attachments only (missing on server)
    const healed = await ensureRequiredAttachments(storage);
    console.info(
      `[authord] No content delta. Healed ${healed} missing attachment(s).`,
    );
    return;
  }

  // ---- Update page content
  await pageRepo.putStorageBody(pageId, storage, options.title);

  // ---- Ensure attachments after update
  const healed = await ensureRequiredAttachments(storage);

  // ---- Persist new hash (brand to ExportHash)
  await props.setExportHash(pageId, makeExportHash(newHash));

  console.info(
    `[authord] Published page ${String(pageId)} (attachments added: ${healed}).`,
  );
}


