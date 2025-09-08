// deno-lint-ignore-file no-explicit-any
/**
 * ConfluenceSinglePagePublisher
 * ---------------------------------------------------------------------------
 * Purpose: Orchestrate the end-to-end flow for the "confluence-single" command:
 *   1) Resolve input (writerside.cfg preferred; markdown-only fallback).
 *   2) Build FinalDocsetAst (via DocsetAssembler or synthetic MD docset).
 *   3) Render + compose into a single Confluence page (Storage XHTML).
 *   4) Sync to a target Confluence page (hash-based idempotency + attachments).
 *
 * Design:
 * - Pure composition; no persistence here. Uses injected ports/factories.
 * - Small helpers for path resolution and attachment content-type detection.
 * - Tests can inject fake assembler/renderer/composer/sync/fs to isolate logic.
 */

import * as path from "node:path";
import { ConfluenceStorageRenderer } from "./application/confluence_storage_renderer.ts";
import { AuthordAstAssembler, type AuthordAst, type Resource } from "./application/authord_ast_assembler.ts";
import { SinglePageComposer, SinglePageComposerOptions } from "./application/single_page_composer.ts";
import type { IFileSystem, IMarkdownTransformer, IPageRepository, IAttachmentRepository, IPropertyStore } from "./ports/ports.ts";
import { ConfluenceSync } from "./sync/confluence_sync.ts";
import { PageId, Path as BrandPath } from "./utils/types.ts";
import { loadMacrosFromVars } from "./domain/parse/vars_parser.ts";

/* --------------------------- Option / Result types --------------------------- */

export type ExecuteOptions = {
  rootDir: string;
  cfgPath?: string | null;
  mdPaths?: readonly string[];
  /** Local images directory containing referenced attachments. */
  imagesDir: string;
  /** Remote Confluence page id to publish into. */
  pageId: PageId;
  /** Title override for the single-page document. */
  title: string;
  /** Composer options (TOC, headings, separators). */
  composer?: Partial<Omit<SinglePageComposerOptions, "title">>;
  /** Allow remote XSD/DTD fetch (topic + vars validation). Default: false. */
  allowRemoteSchemaFetch?: boolean;
};

export type ExecuteResult = {
  pageId: PageId;
  updatedBody: boolean;
  uploadedAttachments: number;
  mode: "writerside-docset" | "markdown-fallback";
};

/* ------------------------------- Dependencies -------------------------------- */

export type ConfluenceSinglePagePublisherPorts = {
  fs: IFileSystem;
  markdown: IMarkdownTransformer;
  pageRepo: IPageRepository;
  attachRepo: IAttachmentRepository;
  props: IPropertyStore;
};

/* -------------------- ConfluenceSinglePagePublisher Class -------------------- */

export class ConfluenceSinglePagePublisher {
  readonly assembler: AuthordAstAssembler;
  readonly renderer: ConfluenceStorageRenderer;
  readonly composer: SinglePageComposer;
  readonly sync: ConfluenceSync;

  constructor(
    readonly ports: ConfluenceSinglePagePublisherPorts,
  ) {
    this.assembler = new AuthordAstAssembler();
    this.renderer = new ConfluenceStorageRenderer({
      markdown: ports.markdown,
      rehypeOpts: { insertToc: false },
    });
    this.composer = new SinglePageComposer(this.renderer, ports.markdown);
    this.sync = new ConfluenceSync(ports.pageRepo, ports.attachRepo, ports.props);
  }

  /** Main entrypoint. Pure orchestration with clear log points. */
  async execute(opts: ExecuteOptions): Promise<ExecuteResult> {
    const {
      rootDir,
      cfgPath,
      mdPaths = [],
      imagesDir,
      pageId,
      title,
      composer = {},
      allowRemoteSchemaFetch = false,
    } = opts;

    // 1) Decide mode: writerside.cfg (preferred) or markdown-only fallback.
    const preferredCfg = cfgPath ?? path.resolve(rootDir, "writerside.cfg");
    const hasCfg = await this.ports.fs.exists(this.asBrand(preferredCfg));
    const mode: ExecuteResult["mode"] = hasCfg
      ? "writerside-docset"
      : "markdown-fallback";

    // 2) Build FinalDocsetAst
    const docset =
      mode === "writerside-docset"
        ? await this.#buildDocset(preferredCfg, allowRemoteSchemaFetch)
        : await this.#buildMarkdownFallbackDocset(rootDir, mdPaths);

    // 3) Compose single page
    const page = await this.composer.build(docset, {
      title,
      insertToc: composer.insertToc ?? true,
      sectionHeadingLevel: composer.sectionHeadingLevel ?? 2,
      insertSeparators: composer.insertSeparators ?? false,
      resolveAttachment: (filename) =>
        this.#resolveAttachmentFromImages(imagesDir, filename),
    });

    // 4) Sync (hash-based idempotency handled by ConfluenceSync)
    const res = await this.sync.sync(page, {
      pageId,
      titleOverride: title,
    });

    return {
      pageId: res.pageId,
      updatedBody: res.updatedBody,
      uploadedAttachments: res.uploadedAttachments.length,
      mode,
    };
  }

  /* ---------------------------- Docset construction --------------------------- */

  async #buildDocset(
    cfgPath: string,
    allowRemoteSchemaFetch: boolean,
  ): Promise<AuthordAst> {
    const resource = this.#makeResource(this.ports.fs);
    const macros = await loadMacrosFromVars(resource, cfgPath);

    const docset = await this.assembler.build({
      cfgPath,
      resource,
      macros,
      fetchExternalCode: true,
      maxIncludeDepth: 20,
      allowRemoteSchemaFetch,
    });
    return docset;
  }

  /**
   * Extremely small synthetic docset for markdown fallback.
   * Uses only the composer + markdown transformer pipeline.
   */
  async #buildMarkdownFallbackDocset(
    rootDir: string,
    mdPathsInput: readonly string[],
  ): Promise<AuthordAst> {
    // Resolve and filter to existing *.md files
    const candidates =
      mdPathsInput.length > 0
        ? mdPathsInput
        : [path.resolve(rootDir, "topics", "README.md")];

    const mdPaths: string[] = [];
    for (const p of candidates) {
      const abs = path.isAbsolute(p) ? p : path.resolve(rootDir, p);
      if (
        abs.toLowerCase().endsWith(".md") &&
        await this.ports.fs.exists(this.asBrand(abs))
      ) {
        mdPaths.push(abs);
      }
    }
    if (mdPaths.length === 0) {
      throw new Error(
        "No writerside.cfg found and no markdown files available for fallback.",
      );
    }

    // FinalDocsetAst with only md pages; instances empty => composer uses docset order
    const pages = await Promise.all(
      mdPaths.map(async (p) => {
        const text = await this.ports.fs.readText(this.asBrand(p));
        const mdAst = {
          type: "element",
          name: "md-page",
          attributes: { src: p },
          children: [{ type: "text", value: text }],
        } as any;
        return { path: p, kind: "markdown" as const, ast: mdAst };
      }),
    );

    const docset: AuthordAst = {
      type: "docset",
      data: { cfg: { topicsDir: ".", instances: [] } as any },
      instances: [],
      pages,
    };
    return docset;
  }

  /* --------------------------------- Helpers --------------------------------- */

  #makeResource(fs: IFileSystem): Resource {
    return {
      readText: (p: string) => fs.readText(this.asBrand(p)),
      exists: (p: string) => fs.exists(this.asBrand(p)),
      resolve: (base: string, target: string) => {
        if (/^https?:\/\//i.test(target)) return target;
        if (path.isAbsolute(target)) return target;
        const root = this.#isDirLike(base) ? base : path.dirname(base);
        return path.resolve(root, target);
      },
    };
  }

  #isDirLike(p: string): boolean {
    return p.endsWith(path.sep) || !path.extname(p);
  }

  asBrand(p: string): BrandPath {
    return p as unknown as BrandPath;
  }

  #resolveAttachmentFromImages(imagesDir: string, filename: string) {
    const abs = path.resolve(imagesDir, filename);
    return {
      filePath: this.asBrand(abs),
      fileName: filename,
      contentType: guessContentType(filename),
    };
  }
}

/* ----------------------------- tiny content-types ---------------------------- */

function guessContentType(name: string): string | undefined {
  const ext = name.toLowerCase().replace(/^.*\./, "");
  switch (ext) {
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "gif": return "image/gif";
    case "svg": return "image/svg+xml";
    case "webp": return "image/webp";
    case "pdf": return "application/pdf";
    case "txt": return "text/plain";
    case "md": return "text/markdown";
    default: return undefined;
  }
}