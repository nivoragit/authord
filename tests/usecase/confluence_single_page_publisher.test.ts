// // deno-lint-ignore-file no-explicit-any

// import { ConfluenceSinglePagePublisher } from "../../lib/confluence_single_page_publisher.ts";




// /* -----------------------------------------------------------------------------
//  * Lightweight test doubles for ports + collaborators
//  * -------------------------------------------------------------------------- */

// class MemFS {
//   private files = new Map<string, string>();
//   addFile(p: string, text: string) { this.files.set(p, text); }
//   async readText(p: any): Promise<string> {
//     const k = p as unknown as string;
//     const v = this.files.get(k);
//     if (v === undefined) throw new Error(`ENOENT: ${k}`);
//     return v;
//   }
//   async exists(p: any): Promise<boolean> {
//     return this.files.has(p as unknown as string);
//   }
//   async glob(): Promise<readonly any[]> { return []; }
//   async list(): Promise<readonly any[]> { return []; }
// }

// class EchoMarkdownTransformer {
//   async toStorage(text: string): Promise<any> {
//     // very small storage XHTML body
//     return `<p>${text}</p>` as unknown as any;
//   }
// }

// class NoopPageRepo {
//   calls: Array<{ id: any; body: string; title?: string }> = [];
//   async putStorageBody(pageId: any, storage: any, title?: string) {
//     this.calls.push({ id: pageId, body: storage as unknown as string, title });
//   }
// }

// class NoopAttachRepo {
//   async list(): Promise<any[]> { return []; }
//   async ensure(_pageId: any, _p: any, _ctype?: string): Promise<any> {
//     return { id: "att" };
//   }
// }

// class MemProps {
//   private map = new Map<string, string>();
//   async getExportHash(pageId: any): Promise<string | null> {
//     return this.map.get(String(pageId)) ?? null;
//   }
//   async setExportHash(pageId: any, hash: string): Promise<void> {
//     this.map.set(String(pageId), hash);
//   }
// }

// /** Stub composer that:
//  *  - Captures the options it received
//  *  - Invokes resolveAttachment on a provided list of filenames
//  *  - Returns a fixed ConfluencePage shape
//  */
// class StubComposer {
//   constructor(private readonly filesToResolve: string[] = []) {}
//   lastOpts?: any;
//   lastDocset?: any;
//   async build(docset: any, opts: any) {
//     this.lastDocset = docset;
//     this.lastOpts = {
//       title: opts.title,
//       insertToc: opts.insertToc,
//       sectionHeadingLevel: opts.sectionHeadingLevel,
//       insertSeparators: opts.insertSeparators,
//     };
//     const attachments: any[] = [];
//     if (opts.resolveAttachment) {
//       for (const f of this.filesToResolve) {
//         const res = opts.resolveAttachment(f);
//         if (res && res.filePath) attachments.push(res);
//       }
//     }
//     return {
//       title: opts.title,
//       storageHtml: "<p>body</p>" as unknown as any,
//       attachments,
//     };
//   }
// }

// /** Stub assembler that returns a pre-baked docset and captures flags. */
// class StubAssembler {
//   lastAllowRemote?: boolean;
//   docset: any;
//   constructor(docset: any) { this.docset = docset; }
//   async build(args: any) {
//     this.lastAllowRemote = Boolean(args.allowRemoteSchemaFetch);
//     return this.docset;
//   }
// }

// /** Stub sync that just echoes inputs and reports uploadedAttachments based on page.attachments length. */
// class StubSync {
//   lastPage?: any;
//   lastTarget?: any;
//   result?: any;
//   async sync(page: any, target: any) {
//     this.lastPage = page;
//     this.lastTarget = target;
//     if (this.result) return this.result;
//     const uploaded = (page.attachments ?? []).map((_:any, i: number) => ({ id: String(i) }));
//     return { pageId: target.pageId, updatedBody: true, uploadedAttachments: uploaded };
//   }
// }

// /* -----------------------------------------------------------------------------
//  * Helpers
//  * -------------------------------------------------------------------------- */

// function mkPublisher(
//   {
//     fs = new MemFS(),
//     markdown = new EchoMarkdownTransformer(),
//     pageRepo = new NoopPageRepo(),
//     attachRepo = new NoopAttachRepo(),
//     props = new MemProps(),
//   }: Partial<Record<"fs" | "markdown" | "pageRepo" | "attachRepo" | "props", any>> = {},
//   overrides: Partial<Record<"assembler" | "composer" | "sync", any>> = {},
// ) {
//   const ports = { fs, markdown, pageRepo, attachRepo, props };
//   const pub = new ConfluenceSinglePagePublisher(ports as any);
//   return { pub, fs, markdown, pageRepo, attachRepo, props };
// }

// /* -----------------------------------------------------------------------------
//  * Tests
//  * -------------------------------------------------------------------------- */

// Deno.test("markdown fallback: publishes single page and maps attachments via imagesDir", async () => {
//   const fs = new MemFS();
//   const root = "/repo";
//   const images = "/repo/images";
//   const md = "/repo/topics/page.md";
//   fs.addFile(md, `hello`);
//   fs.addFile(`${images}/img1.png`, "PNGDATA"); // not used by stub sync, but realistic

//   const composer = new StubComposer(["img1.png"]);
//   const sync = new StubSync();

//   const { pub } = mkPublisher({ fs }, { composer, sync });

//   const res = await pub.execute({
//     rootDir: root,
//     cfgPath: null,              // no cfg -> fallback
//     mdPaths: [md],
//     imagesDir: images,
//     pageId: "P1" as any,
//     title: "Docs",
//   } as any);

//   if (res.mode !== "markdown-fallback") throw new Error(`mode mismatch: ${res.mode}`);
//   if (!sync.lastPage) throw new Error("sync did not receive page");
//   const atts = sync.lastPage.attachments ?? [];
//   if (atts.length !== 1) throw new Error(`expected 1 attachment, got ${atts.length}`);
//   if ((atts[0].filePath as any) !== `${images}/img1.png`) throw new Error("attachment path not resolved under imagesDir");
//   if (atts[0].contentType !== "image/png") throw new Error(`contentType mismatch: ${atts[0].contentType}`);
//   if (composer.lastOpts?.insertToc !== true) throw new Error("default insertToc should be true");
//   if (composer.lastOpts?.sectionHeadingLevel !== 2) throw new Error("default sectionHeadingLevel should be 2");
//   if (composer.lastOpts?.insertSeparators !== false) throw new Error("default insertSeparators should be false");
// });

// Deno.test("markdown fallback: uses default /topics/README.md when mdPaths empty", async () => {
//   const fs = new MemFS();
//   const root = "/repo";
//   const readme = "/repo/topics/README.md";
//   fs.addFile(readme, "# hi");

//   const composer = new StubComposer([]);
//   const { pub } = mkPublisher({ fs }, { composer });

//   const res = await pub.execute({
//     rootDir: root,
//     cfgPath: null,
//     mdPaths: [],
//     imagesDir: "/repo/images",
//     pageId: "P2" as any,
//     title: "Title",
//   } as any);

//   if (res.mode !== "markdown-fallback") throw new Error(`mode mismatch: ${res.mode}`);
//   const pages = composer.lastDocset?.pages ?? [];
//   if (pages.length !== 1) throw new Error(`expected 1 page in fallback docset, got ${pages.length}`);
//   if (pages[0]?.path !== readme) throw new Error(`expected fallback path ${readme}, got ${pages[0]?.path}`);
// });

// Deno.test("markdown fallback: throws when no markdown files available", async () => {
//   const fs = new MemFS();
//   const { pub } = mkPublisher({ fs });

//   let threw = false;
//   try {
//     await pub.execute({
//       rootDir: "/repo",
//       cfgPath: null,
//       mdPaths: ["/repo/notes.txt"], // not .md
//       imagesDir: "/repo/images",
//       pageId: "PX" as any,
//       title: "X",
//     } as any);
//   } catch (e) {
//     threw = String(e?.message ?? e).includes("No writerside.cfg") ||
//             String(e?.message ?? e).includes("No writerside");
//   }
//   if (!threw) throw new Error("expected error about no markdown files");
// });

// Deno.test("writerside mode: prefers cfg when present and passes allowRemoteSchemaFetch=false by default", async () => {
//   const fs = new MemFS();
//   const cfg = "/repo/writerside.cfg";
//   fs.addFile(cfg, "<writerside/>");
//   const assembler = new StubAssembler({
//     type: "docset",
//     data: { cfg: { topicsDir: ".", instances: [] } },
//     instances: [],
//     pages: [
//       { path: "/repo/topics/p.md", kind: "markdown", ast: { type: "element", name: "md-page", children: [{ type: "text", value: "X" }] } },
//     ],
//   });
//   const composer = new StubComposer([]);
//   const { pub } = mkPublisher({ fs }, { assembler, composer });

//   const res = await pub.execute({
//     rootDir: "/repo",
//     cfgPath: cfg,
//     mdPaths: ["/repo/topics/alt.md"], // should be ignored due to cfg
//     imagesDir: "/repo/images",
//     pageId: "P3" as any,
//     title: "T",
//   } as any);

//   if (res.mode !== "writerside-docset") throw new Error(`mode mismatch: ${res.mode}`);
//   if (assembler.lastAllowRemote !== false) throw new Error("allowRemoteSchemaFetch should default to false");
// });

// Deno.test("writerside mode: allowRemoteSchemaFetch=true flows to assembler", async () => {
//   const fs = new MemFS();
//   const cfg = "/repo/writerside.cfg";
//   fs.addFile(cfg, "<writerside/>");
//   const assembler = new StubAssembler({
//     type: "docset",
//     data: { cfg: { topicsDir: ".", instances: [] } },
//     instances: [],
//     pages: [
//       { path: "/repo/topics/p.md", kind: "markdown", ast: { type: "element", name: "md-page", children: [{ type: "text", value: "X" }] } },
//     ],
//   });
//   const composer = new StubComposer([]);
//   const { pub } = mkPublisher({ fs }, { assembler, composer });

//   await pub.execute({
//     rootDir: "/repo",
//     cfgPath: cfg,
//     allowRemoteSchemaFetch: true,
//     imagesDir: "/repo/images",
//     pageId: "P4" as any,
//     title: "T",
//   } as any);

//   if (assembler.lastAllowRemote !== true) throw new Error("allowRemoteSchemaFetch should be true when requested");
// });

// Deno.test("composer options: overrides propagate to composer (no-toc, heading-level, separators)", async () => {
//   const fs = new MemFS();
//   const composer = new StubComposer([]);
//   const { pub } = mkPublisher({ fs }, { composer });

//   fs.addFile("/repo/topics/README.md", "hi");
//   const res = await pub.execute({
//     rootDir: "/repo",
//     cfgPath: null,
//     mdPaths: [],
//     imagesDir: "/repo/images",
//     pageId: "P5" as any,
//     title: "Title",
//     composer: { insertToc: false, sectionHeadingLevel: 4, insertSeparators: true },
//   } as any);

//   if (res.mode !== "markdown-fallback") throw new Error(`mode mismatch: ${res.mode}`);
//   if (composer.lastOpts?.insertToc !== false) throw new Error("insertToc should be false");
//   if (composer.lastOpts?.sectionHeadingLevel !== 4) throw new Error("sectionHeadingLevel should be 4");
//   if (composer.lastOpts?.insertSeparators !== true) throw new Error("insertSeparators should be true");
// });

// Deno.test("resolveAttachment: maps file names to imagesDir and guesses content-types", async () => {
//   const fs = new MemFS();
//   fs.addFile("/repo/topics/README.md", "x");

//   const filenames = ["a.png","b.jpg","c.jpeg","d.gif","e.svg","f.pdf","g.txt","h.md","i.bin"];
//   const composer = new StubComposer(filenames);
//   const sync = new StubSync();

//   const { pub } = mkPublisher({ fs }, { composer, sync });

//   await pub.execute({
//     rootDir: "/repo",
//     cfgPath: null,
//     mdPaths: [],
//     imagesDir: "/repo/images",
//     pageId: "P6" as any,
//     title: "T",
//   } as any);

//   const atts = sync.lastPage?.attachments ?? [];
//   if (atts.length !== filenames.length) {
//     throw new Error(`expected ${filenames.length} attachments, got ${atts.length}`);
//   }

//   const byName = new Map<string, any>();
//   for (const a of atts) byName.set(a.fileName, a);

//   const expect: Record<string, string | undefined> = {
//     "a.png": "image/png",
//     "b.jpg": "image/jpeg",
//     "c.jpeg": "image/jpeg",
//     "d.gif": "image/gif",
//     "e.svg": "image/svg+xml",
//     "f.pdf": "application/pdf",
//     "g.txt": "text/plain",
//     "h.md": "text/markdown",
//     "i.bin": undefined,
//   };

//   for (const [name, ctype] of Object.entries(expect)) {
//     const a = byName.get(name);
//     if (!a) throw new Error(`missing attachment for ${name}`);
//     if (a.filePath !== `/repo/images/${name}`) throw new Error(`path mismatch for ${name}: ${a.filePath}`);
//     if (a.contentType !== ctype) throw new Error(`ctype mismatch for ${name}: ${a.contentType} vs ${ctype}`);
//   }
// });

// Deno.test("sync target receives titleOverride and pageId; ExecuteResult mirrors sync output", async () => {
//   const fs = new MemFS();
//   fs.addFile("/repo/topics/README.md", "Z");

//   const composer = new StubComposer([]);
//   const sync = new StubSync();
//   sync.result = { pageId: "PP" as any, updatedBody: false, uploadedAttachments: [{ id: "1" }, { id: "2" }] };

//   const { pub } = mkPublisher({ fs }, { composer, sync });

//   const res = await pub.execute({
//     rootDir: "/repo",
//     cfgPath: null,
//     mdPaths: [],
//     imagesDir: "/repo/images",
//     pageId: "PP" as any,
//     title: "Custom Title",
//   } as any);

//   if (sync.lastTarget?.pageId !== "PP") throw new Error("pageId not forwarded to sync");
//   if (sync.lastTarget?.titleOverride !== "Custom Title") throw new Error("titleOverride not forwarded to sync");
//   if (res.pageId !== "PP") throw new Error("ExecuteResult.pageId mismatch");
//   if (res.updatedBody !== false) throw new Error("ExecuteResult.updatedBody mismatch");
//   if (res.uploadedAttachments !== 2) throw new Error("ExecuteResult.uploadedAttachments mismatch");
// });
