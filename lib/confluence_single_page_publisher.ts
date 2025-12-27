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
import { ConfluenceStorageRenderer } from "./core/application/confluence_storage_renderer.ts";
import { AuthordAstAssembler, type AuthordAst } from "./core/application/authord_ast_assembler.ts";
import { SinglePageComposer, SinglePageComposerOptions } from "./core/application/single_page_composer.ts";
import type { IFileSystem, IMarkdownTransformer, IPageRepository, IAttachmentRepository, IPropertyStore } from "./core/ports/ports.ts";
import { ConfluenceSync } from "./core/application/confluence_sync.ts";
import { PageId, Path as BrandPath, Path, ConfluenceCfg } from "./core/shared/types.ts";
import type { Resource } from "./core/shared/resource.ts";
import { loadMacrosFromVars } from "./core/domain/parse/vars_parser.ts";
import { WritersideMarkdownTransformer } from "./writerside_markdown_transformer.ts";
import { ConfluenceAttachmentRepository, ConfluencePageRepository, ConfluencePropertyStore } from "./confluence_api/confluence_repos.ts";
import { makeLocalFirstCachingFetcher } from "./utils/schema_fetcher.ts";

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

/* ------------------------------ Local FS adapter ----------------------------- */

class DenoFileSystem implements IFileSystem {
  async readText(p: Path): Promise<string> {
    const pp = p as unknown as string;
    return await Deno.readTextFile(pp);
  }
  async exists(p: Path): Promise<boolean> {
    const pp = p as unknown as string;
    try {
      const st = await Deno.stat(pp);
      const kind = st.isFile ? "file" : st.isDirectory ? "dir" : "other";
      // console.debug(`[authord:debug] fs.exists -> ${pp} (true, ${kind})`);
      return true;
    } catch {
      // console.debug(`[authord:debug] fs.exists -> ${pp} (false)`);
      return false;
    }
  }
  async glob(_pattern: string, _cwd?: Path): Promise<readonly Path[]> {
    return [];
  }
  async list(_dir: Path): Promise<readonly Path[]> {
    return [];
  }
}

/* -------------------- ConfluenceSinglePagePublisher Class -------------------- */

export class ConfluenceSinglePagePublisher {
  private constructor(
    readonly ports: ConfluenceSinglePagePublisherPorts,
    readonly assembler: AuthordAstAssembler,
    readonly renderer: ConfluenceStorageRenderer,
    readonly composer: SinglePageComposer,
    readonly sync: ConfluenceSync,
  ) {}

  static build(cfg: ConfluenceCfg, imagesDir: string) {
    const fs = new DenoFileSystem();
    const markdown = new WritersideMarkdownTransformer(imagesDir);
  
    const pageRepo = new ConfluencePageRepository(cfg);
    const attachRepo = new ConfluenceAttachmentRepository(cfg);
    const props = new ConfluencePropertyStore(cfg);
    const assembler = new AuthordAstAssembler();
    const renderer = new ConfluenceStorageRenderer({
      markdown: markdown,
      rehypeOpts: { insertToc: false },
    }, imagesDir);
    const composer = new SinglePageComposer(renderer, markdown);
    const sync = new ConfluenceSync(pageRepo, attachRepo, props);
    const ports = {fs, markdown, pageRepo, attachRepo, props};
  
    return new ConfluenceSinglePagePublisher(ports,assembler, renderer, composer, sync);
  }

  /** Main entrypoint. Pure orchestration with clear log points. */
  async execute(opts: ExecuteOptions): Promise<ExecuteResult> {
    const {
      rootDir,
      cfgPath,
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
    const docset = await this.#buildDocset(preferredCfg, allowRemoteSchemaFetch);

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
    const fetcher = makeLocalFirstCachingFetcher({
      // todo: hardcoded paths; make configurable later?
      cacheMap: {
        "https://resources.jetbrains.com/writerside/1.0/writerside-cfg.xsd":
          "cfg/schemas/writerside-cfg.xsd",
        "https://resources.jetbrains.com/writerside/1.0/ihp.dtd": "cfg/schemas/ihp.dtd",
        // add others your project uses:
        "https://resources.jetbrains.com/writerside/1.0/product-profile.dtd": "cfg/schemas/instance-profile.dtd",
        // "https://resources.jetbrains.com/writerside/1.0/topic.xsd": "cfg/schemas/topic.xsd",
      },
      allowNetwork: true, // local-first; downloads if missing
    });

    return await this.assembler.build({
      cfgPath,
      resource,
      macros,
      fetchExternalCode: true,
      maxIncludeDepth: 20,
      allowRemoteSchemaFetch,
      fetcher,
    });
    
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
