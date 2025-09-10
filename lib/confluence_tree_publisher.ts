// // deno-lint-ignore-file no-explicit-any
// /**
//  * ConfluenceTreePublisher
//  * ---------------------------------------------------------------------------
//  * Purpose: Publish a Writerside/Authord docset as a Confluence page tree.
//  *   - Derives hierarchy from Writerside instances (<toc-element> nesting).
//  *   - Creates/fetches child pages under the provided root page.
//  *   - Renders each topic/markdown page separately and syncs via ConfluenceSync
//  *     (hash idempotency + attachment uploads per page).
//  */

// import * as path from "node:path";
// import type { Element as XEl } from "xast";
// import { ConfluenceStorageRenderer } from "./application/confluence_storage_renderer.ts";
// import { AuthordAstAssembler, type AuthordAst, type Resource } from "./application/authord_ast_assembler.ts";
// import { SinglePageComposer } from "./application/single_page_composer.ts";
// import type { IFileSystem, IMarkdownTransformer, IPageRepository, IAttachmentRepository, IPropertyStore } from "./ports/ports.ts";
// import { ConfluenceSync } from "./sync/confluence_sync.ts";
// import { ConfluenceChildPageResolver, type IChildPageResolver } from "./confluence_api/child_page_resolver.ts";
// import { PageId, Path as BrandPath, Path, ConfluenceCfg } from "./utils/types.ts";
// import { loadMacrosFromVars } from "./domain/parse/vars_parser.ts";
// import { WritersideMarkdownTransformer } from "./writerside_markdown_transformer.ts";

// /* --------------------------- Option / Result types --------------------------- */

// export type ExecuteTreeOptions = {
//   rootDir: string;
//   cfgPath?: string | null;
//   /** For md-only projects where no Writerside cfg exists. */
//   mdPaths?: readonly string[];
//   /** Local images directory containing referenced attachments. */
//   imagesDir: string;
//   /** Root Confluence page id under which the tree is published. */
//   rootPageId: PageId;
//   /** Optional: fallback page title for root children if filename-derived. */
//   defaultTitle?: string;
//   /** Allow remote XSD/DTD fetch (topic + vars validation). Default: false. */
//   allowRemoteSchemaFetch?: boolean;
// };

// export type ExecuteTreeResult = {
//   rootPageId: PageId;
//   mode: "writerside-docset" | "markdown-fallback";
//   pagesPublished: number;
//   pagesUpdated: number;
//   attachmentsUploaded: number;
// };

// /* ------------------------------- Dependencies -------------------------------- */

// export type ConfluenceTreePublisherPorts = {
//   fs: IFileSystem;
//   markdown: IMarkdownTransformer;
//   pageRepo: IPageRepository;
//   attachRepo: IAttachmentRepository;
//   props: IPropertyStore;
//   // Optional injections (defaults provided in constructor):
//   assembler?: AuthordAstAssembler;
//   renderer?: ConfluenceStorageRenderer;
//   composer?: SinglePageComposer;
//   sync?: ConfluenceSync;
//   childResolver?: IChildPageResolver;
// };

// /* ------------------------------ Local FS adapter ----------------------------- */

// class DenoFileSystem implements IFileSystem {
//   async readText(p: Path): Promise<string> {
//     const pp = p as unknown as string;
//     return await Deno.readTextFile(pp);
//   }
//   async exists(p: Path): Promise<boolean> {
//     const pp = p as unknown as string;
//     try {
//       const st = await Deno.stat(pp);
//       return st.isFile || st.isDirectory;
//     } catch {
//       return false;
//     }
//   }
//   async glob(_pattern: string, _cwd?: Path): Promise<readonly Path[]> {
//     return [];
//   }
//   async list(_dir: Path): Promise<readonly Path[]> {
//     return [];
//   }
// }

// /* -------------------------- ConfluenceTreePublisher -------------------------- */

// export class ConfluenceTreePublisher {
//   readonly assembler: AuthordAstAssembler;
//   readonly renderer: ConfluenceStorageRenderer;
//   readonly composer: SinglePageComposer;
//   readonly sync: ConfluenceSync;
//   readonly childResolver: IChildPageResolver;

//   private constructor(
//     readonly ports: ConfluenceTreePublisherPorts,
//     readonly cfg: ConfluenceCfg,
//     readonly imagesDir: string,
//   ) {
//     this.assembler = ports.assembler ?? new AuthordAstAssembler();
//     this.renderer = ports.renderer ?? new ConfluenceStorageRenderer({
//       markdown: ports.markdown,
//       rehypeOpts: { insertToc: false },
//     });
//     this.composer = ports.composer ?? new SinglePageComposer(this.renderer, ports.markdown);
//     this.sync = ports.sync ?? new ConfluenceSync(ports.pageRepo, ports.attachRepo, ports.props);
//     this.childResolver = ports.childResolver ?? new ConfluenceChildPageResolver(cfg);
//   }

//   static build(cfg: ConfluenceCfg, imagesDir: string) {
//     const fs = new DenoFileSystem();
//     const markdown = new WritersideMarkdownTransformer(imagesDir);
//     // Keep using your existing adapters:
//     // (These imports should match your concrete adapter locations)
//     // If your repo class names are different, adjust here.
//     const { ConfluencePageRepository, ConfluenceAttachmentRepository, ConfluencePropertyStore } =
//       await import("./confluence_api/confluence_repos.ts");

//     const pageRepo = new ConfluencePageRepository(cfg);
//     const attachRepo = new ConfluenceAttachmentRepository(cfg);
//     const props = new ConfluencePropertyStore(cfg);

//     return new ConfluenceTreePublisher(
//       { fs, markdown, pageRepo, attachRepo, props },
//       cfg,
//       imagesDir,
//     );
//   }

//   /** Entrypoint: publishes the tree and returns summary. */
//   async execute(opts: ExecuteTreeOptions): Promise<ExecuteTreeResult> {
//     const {
//       rootDir,
//       cfgPath,
//       imagesDir,
//       rootPageId,
//       defaultTitle = "Untitled",
//       allowRemoteSchemaFetch = false,
//     } = opts;

//     const preferredCfg = cfgPath ?? path.resolve(rootDir, "writerside.cfg");
//     const hasCfg = await this.ports.fs.exists(this.asBrand(preferredCfg));
//     const mode: ExecuteTreeResult["mode"] = hasCfg
//       ? "writerside-docset"
//       : "markdown-fallback";

//     const docset = await this.#buildDocset(preferredCfg, allowRemoteSchemaFetch);

//     const topicsRootAbs = this.#resolveTopicsRootAbs(preferredCfg, docset);
//     const pageIndex = new Map<string, AuthordAst["pages"][number]>();
//     for (const p of docset.pages) pageIndex.set(p.path, p);

//     const absToRel = (abs: string) => path.relative(topicsRootAbs, abs).replaceAll("\\", "/");

//     // Build hierarchy using the *first* instance tree (common case).
//     const roots = this.#buildHierarchyFromInstances(docset, topicsRootAbs, pageIndex);

//     // If no structure from instances, publish all pages as direct children.
//     const unreferenced = new Set(docset.pages.map((p) => p.path));
//     for (const n of roots) this.#collectAbsPaths(n).forEach((abs) => unreferenced.delete(abs));

//     let orphansRoot: PageId | null = null;
//     let pagesPublished = 0;
//     let pagesUpdated = 0;
//     let attachmentsUploaded = 0;

//     const publishOne = async (absPath: string, parentId: PageId) => {
//       const entry = pageIndex.get(absPath);
//       if (!entry) return;
//       const title = this.#deriveTitle(absPath, defaultTitle);
//       const childId = await this.childResolver.ensureChild(parentId, title);

//       // Build a "single-page" mini docset to reuse composer + sync.
//       const mini: AuthordAst = {
//         type: "docset",
//         data: docset.data,
//         instances: [],
//         pages: [entry],
//       };
//       const page = await this.composer.build(mini, {
//         title,
//         insertToc: false,
//         sectionHeadingLevel: 2,
//         insertSeparators: false,
//         resolveAttachment: (filename) =>
//           this.#resolveAttachmentFromImages(imagesDir, filename),
//       });

//       const res = await this.sync.sync(page, { pageId: childId, titleOverride: title });
//       pagesPublished += 1;
//       if (res.updatedBody) pagesUpdated += 1;
//       attachmentsUploaded += res.uploadedAttachments.length;
//       return childId;
//     };

//     const publishTree = async (node: TreeNode, parentId: PageId) => {
//       const currentId = await publishOne(node.absPath, parentId);
//       const pid = currentId ?? parentId;
//       for (const ch of node.children) await publishTree(ch, pid);
//     };

//     if (roots.length) {
//       for (const r of roots) await publishTree(r, rootPageId);
//     }

//     if (unreferenced.size) {
//       // Publish orphans under "Orphans" container (create only if needed).
//       const orphansTitle = "Orphans";
//       orphansRoot = await this.childResolver.ensureChild(rootPageId, orphansTitle);
//       for (const abs of unreferenced) {
//         await publishOne(abs, orphansRoot);
//       }
//     }

//     return {
//       rootPageId,
//       mode,
//       pagesPublished,
//       pagesUpdated,
//       attachmentsUploaded,
//     };
//   }

//   /* ---------------------------- Docset construction --------------------------- */

//   async #buildDocset(cfgPath: string, allowRemoteSchemaFetch: boolean): Promise<AuthordAst> {
//     const resource = this.#makeResource(this.ports.fs);
//     const macros = await loadMacrosFromVars(resource, cfgPath);
//     return await this.assembler.build({
//       cfgPath,
//       resource,
//       macros,
//       fetchExternalCode: true,
//       maxIncludeDepth: 20,
//       allowRemoteSchemaFetch,
//     });
//   }

//   /* -------------------------------- Hierarchy -------------------------------- */

//   type TreeNode = { absPath: string; children: TreeNode[] };

//   #buildHierarchyFromInstances(
//     docset: AuthordAst,
//     topicsRootAbs: string,
//     pageIndex: Map<string, AuthordAst["pages"][number]>,
//   ): TreeNode[] {
//     if (!docset.instances.length) return [];
//     const [firstInst] = docset.instances;

//     // Precompute lookup by (normalized) rel path → abs path present in pages.
//     const relToAbs = new Map<string, string>();
//     for (const abs of pageIndex.keys()) {
//       const rel = path.relative(topicsRootAbs, abs).replaceAll("\\", "/");
//       relToAbs.set(rel, abs);
//     }

//     const localName = (qname: string) => qname.includes(":") ? qname.split(":")[1] : qname;

//     const toNodes = (el: XEl): TreeNode[] => {
//       const out: TreeNode[] = [];
//       for (const c of el.children) {
//         if (c.type !== "element") continue;
//         const name = localName(c.name);
//         if (name !== "toc-element") {
//           out.push(...toNodes(c as XEl));
//           continue;
//         }
//         const topicRel = (c.attributes?.["topic"] as string | undefined)?.trim();
//         if (!topicRel) {
//           out.push(...toNodes(c as XEl));
//           continue;
//         }
//         const normalized = topicRel.replaceAll("\\", "/");
//         const abs = relToAbs.get(normalized) ??
//           relToAbs.get(normalized.endsWith(".topic") || normalized.endsWith(".md") ? normalized : `${normalized}.topic`);
//         if (!abs) {
//           // Topic not found in parsed pages → skip but continue.
//           out.push(...toNodes(c as XEl));
//           continue;
//         }
//         const children = toNodes(c as XEl);
//         out.push({ absPath: abs, children });
//       }
//       return out;
//     };

//     return toNodes(firstInst.ast);
//   }

//   #collectAbsPaths(node: TreeNode, acc: Set<string> = new Set()): Set<string> {
//     acc.add(node.absPath);
//     for (const ch of node.children) this.#collectAbsPaths(ch, acc);
//     return acc;
//   }

//   #deriveTitle(absPath: string, fallback: string): string {
//     const base = path.basename(absPath).replace(/\.(topic|md)$/i, "");
//     const s = base.replace(/[-_.]+/g, " ").trim();
//     return s ? s.charAt(0).toUpperCase() + s.slice(1) : fallback;
//   }

//   #resolveTopicsRootAbs(cfgPath: string, docset: AuthordAst): string {
//     const cfg = docset.data.cfg;
//     const raw = (cfg.topicsDir || "").toString();
//     if (!raw) return path.dirname(cfgPath);
//     return this.#makeResource(this.ports.fs).resolve(cfgPath, raw);
//   }

//   /* --------------------------------- Helpers --------------------------------- */

//   #makeResource(fs: IFileSystem): Resource {
//     return {
//       readText: (p: string) => fs.readText(this.asBrand(p)),
//       exists: (p: string) => fs.exists(this.asBrand(p)),
//       resolve: (base: string, target: string) => {
//         if (/^https?:\/\//i.test(target)) return target;
//         if (path.isAbsolute(target)) return target;
//         const root = this.#isDirLike(base) ? base : path.dirname(base);
//         return path.resolve(root, target);
//       },
//     };
//   }

//   #isDirLike(p: string): boolean {
//     return p.endsWith(path.sep) || !path.extname(p);
//   }

//   asBrand(p: string): BrandPath {
//     return p as unknown as BrandPath;
//   }

//   #resolveAttachmentFromImages(imagesDir: string, filename: string) {
//     const abs = path.resolve(imagesDir, filename);
//     return {
//       filePath: this.asBrand(abs),
//       fileName: filename,
//       contentType: guessContentType(filename),
//     };
//   }
// }

// /* ----------------------------- tiny content-types ---------------------------- */

// function guessContentType(name: string): string | undefined {
//   const ext = name.toLowerCase().replace(/^.*\./, "");
//   switch (ext) {
//     case "png": return "image/png";
//     case "jpg":
//     case "jpeg": return "image/jpeg";
//     case "gif": return "image/gif";
//     case "svg": return "image/svg+xml";
//     case "webp": return "image/webp";
//     case "pdf": return "application/pdf";
//     case "txt": return "text/plain";
//     case "md": return "text/markdown";
//     default: return undefined;
//   }
// }
