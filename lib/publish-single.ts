// Core use case: publish a single flattened document to Confluence.
// - Writerside .cfg docset path (auto-detect writerside.cfg if --md is not .cfg)
// - Markdown fallback path anchored to the MD base directory (fixes 'home.md' at repo root)
// - Deterministic Mermaid materialization
// - Attachment healing + export hash idempotency
// Adds detailed DEBUG logs + smart Writerside 'topics/' resolution.
// NEW: Graceful fallback to Markdown when Writerside docset render fails (e.g., "Invalid .topic").

import * as path from "node:path";
import { setImageDir } from "./utils/images.ts";
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
import { buildDocsetAst } from "./application/build_docset_ast.ts";
import { renderDocsetToConfluence } from "./application/render_docset_to_confluence.ts";
import { mergeStorageFragments } from "./application/storage_merge.ts";

// Local mirror of the Resource type (keeps build products decoupled from type-only imports)
type DocsetResource = {
  readText: (pathOrUrl: string) => Promise<string>;
  exists: (pathOrUrl: string) => Promise<boolean>;
  resolve: (base: string, target: string) => string;
};

export interface PublishDeps {
  fs: IFileSystem;
  ordering: IOrderingResolver;
  transformer: IMarkdownTransformer;
  pageRepo: IPageRepository;
  attachRepo: IAttachmentRepository;
  props: IPropertyStore;
}

let DEPS: PublishDeps | null = null;
export function setPublishDeps(deps: PublishDeps) { DEPS = deps; }

const asStorageXhtml = (s: string): StorageXhtml => s as unknown as StorageXhtml;

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
    if (fn && !seen.has(fn)) { seen.add(fn); out.push(fn); }
  }
  return out;
}

/** Read all files (in order) via IFileSystem and concatenate with blank line between. */
async function readAndConcat(fs: IFileSystem, files: readonly string[]): Promise<string> {
  const parts: string[] = [];
  for (const f of files) {
    console.debug(`[authord:debug] reading markdown: ${f}`);
    parts.push(await fs.readText(asPath(f)));
  }
  return parts.join("\n\n");
}

/** Build the final ordered list, ensuring the explicit entrypoint appears first if necessary. */
function prioritizeEntrypoint(entry: string, ordered: readonly string[]): string[] {
  const set = new Set(ordered);
  const out: string[] = [];
  if (set.has(entry)) { out.push(entry); for (const p of ordered) if (p !== entry) out.push(p); }
  else out.push(entry, ...ordered);
  const seen = new Set<string>();
  const deduped = out.filter((p) => (seen.has(p) ? false : (seen.add(p), true)));
  console.debug(`[authord:debug] prioritizeEntrypoint entry=${entry}`);
  console.debug(`[authord:debug] ordered(raw)=${JSON.stringify(ordered)}`);
  console.debug(`[authord:debug] ordered(final)=${JSON.stringify(deduped)}`);
  return deduped;
}

/** IFileSystem → Docset Resource shim with Writerside-aware resolution. */
function resourceFromFs(fs: IFileSystem, docRoot: string): DocsetResource {
  const topicsRoot = path.join(docRoot, "topics");

  function preferTopics(base: string, target: string): boolean {
    // If resolving from writerside.cfg and the target looks like markdown, prefer topics/
    const baseIsCfg = path.basename(base).toLowerCase() === "writerside.cfg";
    const isMd = /\.md$/i.test(target);
    return baseIsCfg && isMd;
  }

  function computeTopicsFallback(p: string): string {
    // If p is under docRoot and not already in topics/, map p to topics/<relative>
    const inTopics = p.includes(`${path.sep}topics${path.sep}`);
    if (!p.startsWith(docRoot + path.sep) || inTopics) return p;
    const rel = path.relative(docRoot, p);     // e.g., "home.md"
    return path.resolve(topicsRoot, rel);      // e.g., "<root>/topics/home.md"
  }

  return {
    async readText(p: string) {
      try {
        return await fs.readText(asPath(p));
      } catch (e) {
        // Fallback for markdown expected under topics/
        if (/\.md$/i.test(p)) {
          const alt = computeTopicsFallback(p);
          if (alt !== p) {
            console.debug(`[authord:debug] readText fallback -> ${alt}`);
            return await fs.readText(asPath(alt));
          }
        }
        throw e;
      }
    },
    async exists(p: string) {
      const first = await fs.exists(asPath(p));
      if (first) return true;
      if (/\.md$/i.test(p)) {
        const alt = computeTopicsFallback(p);
        if (alt !== p) {
          const second = await fs.exists(asPath(alt));
          console.debug(`[authord:debug] exists fallback check -> ${alt} = ${second}`);
          return second;
        }
      }
      return false;
    },
    resolve(base: string, target: string) {
      if (/^https?:\/\//i.test(target)) return target;
      if (path.isAbsolute(target)) return target;

      const root = path.dirname(base);
      const primary = path.resolve(root, target);

      if (preferTopics(base, target)) {
        const alt = path.resolve(docRoot, "topics", target);
        console.debug(`[authord:debug] resolve prefer topics base=${base} target=${target} -> ${alt}`);
        return alt;
      }

      console.debug(`[authord:debug] resolve base=${base} target=${target} -> ${primary}`);
      return primary;
    },
  };
}

/** Attempt full-docset rendering (gracefully falls back on any error). */
async function tryRenderDocsetToStorage(cfgPath: string, deps: PublishDeps): Promise<string | null> {
  console.debug(`[authord:debug] tryRenderDocsetToStorage cfgPath=${cfgPath}`);
  if (!cfgPath.toLowerCase().endsWith(".cfg")) return null;
  if (!(await deps.fs.exists(asPath(cfgPath)))) {
    console.debug(`[authord:debug] cfg not found: ${cfgPath}`);
    return null;
  }

  const docRoot = path.dirname(cfgPath);
  const resource = resourceFromFs(deps.fs, docRoot);

  try {
    const docset = await buildDocsetAst({ cfgPath, resource, macros: {}, fetchExternalCode: true });
    console.debug(
      `[authord:debug] docset built (pages=${Array.isArray((docset as any)?.pages) ? (docset as any).pages.length : "?"})`,
    );

    const results = await renderDocsetToConfluence(docset, resource, {
      media: { onMermaid: ({ index }) => ({ filename: `mermaid-${index}.png` }) },
      confluence: { insertToc: true, tocPosition: "top", tocMaxLevel: 3 },
    });

    console.debug(`[authord:debug] rendered pages: ${results.length}`);
    return mergeStorageFragments(results.map(r => r.xml));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[authord] Writerside docset render failed, falling back to Markdown: ${msg}`);
    if (err && typeof err === "object" && (err as any).stack) {
      console.debug(`[authord:debug] docset error stack:\n${(err as any).stack}`);
    }
    return null; // trigger Markdown fallback path
  }
}

/** Publish the single page according to the options, using injected ports. */
export async function publishSingle(options: PublishSingleOptions): Promise<void> {
  if (!DEPS) throw new Error("publishSingle deps not set. Call setPublishDeps(...) first.");

  const { fs, ordering, transformer, pageRepo, attachRepo, props } = DEPS;

  // ---- Validate options
  if (!options.rootDir) throw new Error("rootDir is required");
  if (!options.md) throw new Error("md (entry markdown or .cfg) is required");
  if (!options.images) throw new Error("images directory is required");
  if (!options.baseUrl) throw new Error("baseUrl is required");
  if (!options.basicAuth?.username || !options.basicAuth?.password) throw new Error("basicAuth.username/password are required");
  if (!options.pageId) throw new Error("pageId is required");

  const rootDir = options.rootDir as unknown as string;
  const mdEntrypoint = options.md as unknown as string;
  const imagesDir = options.images as unknown as string;
  const pageId: PageId = options.pageId;

  console.debug(`[authord:debug] rootDir=${rootDir}`);
  console.debug(`[authord:debug] mdEntrypoint=${mdEntrypoint}`);
  console.debug(`[authord:debug] imagesDir=${imagesDir}`);

  // ---- Existence checks (root + images first)
  const rootExists = await fs.exists(asPath(rootDir));
  console.debug(`[authord:debug] exists(rootDir)=${rootExists}`);
  if (!rootExists) throw new Error(`rootDir does not exist: ${rootDir}`);

  const imagesExists = await fs.exists(asPath(imagesDir));
  console.debug(`[authord:debug] exists(imagesDir)=${imagesExists}`);
  if (!imagesExists) throw new Error(`images dir does not exist: ${imagesDir}`);

  setImageDir(imagesDir);

  // ---- Choose route: CFG (preferred) or MD fallback
  // Prefer explicit .cfg; if not, auto-detect "<root>/writerside.cfg"
  let cfgPathForDocset: string | null = null;
  if (mdEntrypoint.toLowerCase().endsWith(".cfg")) {
    cfgPathForDocset = mdEntrypoint;
  } else {
    const autoCfg = path.resolve(rootDir, "writerside.cfg");
    const hasAutoCfg = await fs.exists(asPath(autoCfg));
    console.debug(`[authord:debug] auto-detect writerside.cfg at ${autoCfg}: ${hasAutoCfg}`);
    if (hasAutoCfg) cfgPathForDocset = autoCfg;
  }

  // ---- DOCSET PATH (writerside.cfg) FIRST — now safe (errors -> fallback)
  if (cfgPathForDocset) {
    const maybeStorage = await tryRenderDocsetToStorage(cfgPathForDocset, DEPS);
    if (maybeStorage) {
      const storage = asStorageXhtml(maybeStorage);

      const newHash = await sha256Hex(String(storage));
      const currentHash = await props.getExportHash(pageId);
      console.debug(`[authord:debug] export-hash new=${newHash} current=${currentHash ?? "<none>"}`);


      if (currentHash === newHash) {
        const healed = await ensureRequiredAttachments(storage);
        console.info(`[authord] No content delta. Healed ${healed} missing attachment(s).`);
        return;
      }

      await pageRepo.putStorageBody(pageId, storage, options.title);
      const healed = await ensureRequiredAttachments(storage);
      await props.setExportHash(pageId, makeExportHash(newHash));
      console.info(`[authord] Published page ${String(pageId)} (attachments added: ${healed}).`);
      return;
    } else {
      console.debug(`[authord:debug] tryRenderDocsetToStorage returned null; falling back to markdown path`);
    }
  } else {
    console.debug(`[authord:debug] cfgPathForDocset not set; falling back to markdown path`);
  }

  // ---- FALLBACK: Markdown-concat path
  const mdExists = await fs.exists(asPath(mdEntrypoint));
  console.debug(`[authord:debug] exists(mdEntrypoint)=${mdExists}`);
  if (!mdExists) throw new Error(`entry markdown not found: ${mdEntrypoint}`);

  // Determine MD base directory:
  // - If mdEntrypoint is a file: use its dirname
  // - If mdEntrypoint is a dir: prefer "<dir>/topics" if it exists, else the dir itself
  let mdBaseDir =
    path.extname(mdEntrypoint).toLowerCase() === ".md"
      ? path.dirname(mdEntrypoint)
      : mdEntrypoint;

  const candidateTopics = path.join(mdBaseDir, "topics");
  if (await fs.exists(asPath(candidateTopics))) {
    console.debug(`[authord:debug] mdBaseDir adjusted to topics: ${candidateTopics}`);
    mdBaseDir = candidateTopics;
  } else {
    console.debug(`[authord:debug] mdBaseDir=${mdBaseDir} (topics/ not found)`);
    // Also consider "<rootDir>/topics" in case entry md is under root
    const rootTopics = path.join(rootDir, "topics");
    if (await fs.exists(asPath(rootTopics))) {
      console.debug(`[authord:debug] mdBaseDir fallback to root topics: ${rootTopics}`);
      mdBaseDir = rootTopics;
    }
  }

  console.debug(`[authord:debug] ordering.resolve base=${mdBaseDir}`);
  const primaryOrder = await ordering.resolve(asPath(mdBaseDir));
  console.debug(`[authord:debug] ordering returned=${JSON.stringify(primaryOrder)}`);

  // Make all items absolute under mdBaseDir, then prioritize the explicit entrypoint file
  const ordered = prioritizeEntrypoint(
    path.resolve(mdEntrypoint),
    (primaryOrder as readonly string[]).map((p) => path.resolve(mdBaseDir, p)),
  );

  // Filter to .md that exist (via fs) and log misses
  const filtered: string[] = [];
  for (const pth of ordered) {
    const isMd = pth.toLowerCase().endsWith(".md");
    const ex = isMd ? await fs.exists(asPath(pth)) : false;
    console.debug(`[authord:debug] candidate ${pth} isMd=${isMd} exists=${ex}`);
    if (isMd && ex) filtered.push(pth);
  }
  console.debug(`[authord:debug] ordered md files count=${filtered.length}`);
  if (filtered.length === 0) throw new Error("No markdown files to publish after resolution.");

  const markdown = await readAndConcat(fs, filtered);

  // Materialize Mermaid PNGs deterministically
  {
    const mermaidRegex = /```mermaid\s*\n([\s\S]*?)```/g;
    let match: RegExpExecArray | null;
    let mermaidIndex = 1;
    while ((match = mermaidRegex.exec(markdown))) {
      const def = (match[1] || "").trim();
      console.debug(`[authord:debug] mermaid #${mermaidIndex}: ${def ? "render" : "skip-empty"}`);
      if (!def) { mermaidIndex += 1; continue; }
      try {
        const outName = `mermaid-${mermaidIndex}.png`;
        const outPath = path.resolve(imagesDir, outName);
        await renderMermaidDefinitionToFile(def, outPath);
      } catch (err) {
        console.warn(`[authord] Failed to render Mermaid diagram #${mermaidIndex}: ${err instanceof Error ? err.message : err}`);
      } finally {
        mermaidIndex += 1;
      }
    }
  }

  const storage = await transformer.toStorage(markdown);

  const newHash = await sha256Hex(String(storage));
  const currentHash = await props.getExportHash(pageId);
  console.debug(`[authord:debug] export-hash new=${newHash} current=${currentHash ?? "<none>"}`);

  async function ensureRequiredAttachments(s: StorageXhtml): Promise<number> {
    const required = extractAttachmentFilenames(String(s));
    console.debug(`[authord:debug] required attachments: [${required.join(", ")}]`);
    if (required.length === 0) return 0;

    const existing = await attachRepo.list(pageId);
    console.debug(`[authord:debug] existing attachments on page: ${existing.map(e => e.fileName).join(", ") || "<none>"}`);
    const have = new Set(existing.map((e) => e.fileName));

    let uploaded = 0;
    for (const fn of required) {
      if (!have.has(fn)) {
        const abs = path.resolve(imagesDir, fn);
        const exists = await fs.exists(asPath(abs));
        console.debug(`[authord:debug] ensure attach ${fn} -> ${abs}, localExists=${exists}`);
        if (exists) {
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
    const healed = await ensureRequiredAttachments(storage);
    console.info(`[authord] No content delta. Healed ${healed} missing attachment(s).`);
    return;
  }

  await pageRepo.putStorageBody(pageId, storage, options.title);
  const healed = await ensureRequiredAttachments(storage);
  await props.setExportHash(pageId, makeExportHash(newHash));
  console.info(`[authord] Published page ${String(pageId)} (attachments added: ${healed}).`);
}
