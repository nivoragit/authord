import { publishSingle, setPublishDeps, type PublishDeps } from "../lib/publish-single.ts";
import {
  asPageId,
  asPath,
  asUrl,
  asStorageXhtml,
  type PublishSingleOptions,
  type PageId,
  type Path,
  type StorageXhtml,
} from "../lib/utils/types.ts";
import type { AttachmentInfo } from "../lib/ports/ports.ts";
import { makeExportHash, type ExportHash } from "../lib/domain/entities.ts";

// ---- Test doubles (ports)

function normalize(p: string): string {
  return p.replace(/\\/g, "/");
}

function makeFs(files: Record<string, string>): PublishDeps["fs"] {
  return {
    readText(p: Path): Promise<string> {
      const k = normalize(String(p));
      if (!(k in files)) throw new Error(`ENOENT ${k}`);
      return Promise.resolve(files[k]);
    },
    exists(p: Path): Promise<boolean> {
      const k = normalize(String(p));
      const existsFile = k in files;
      const existsDir = Object.keys(files).some((f) => f.startsWith(k.endsWith("/") ? k : k + "/"));
      return Promise.resolve(existsFile || existsDir);
    },
    glob(_pattern: string, _cwd?: Path): Promise<readonly Path[]> {
      return Promise.resolve([] as Path[]);
    },
    list(_dir: Path): Promise<readonly Path[]> {
      return Promise.resolve([] as Path[]);
    },
  };
}

function makeOrdering(paths: string[]): PublishDeps["ordering"] {
  return {
    resolve(_root?: Path): Promise<readonly Path[]> {
      return Promise.resolve(paths.map((p) => asPath(normalize(p))));
    },
  };
}

function makeTransformer(capture?: { lastInput?: string }): PublishDeps["transformer"] {
  return {
    toStorage(md: string): Promise<StorageXhtml> {
      if (capture) capture.lastInput = md;
      // produce XHTML with image references if markers are present in md
      // [img:a.png] becomes ri:filename="a.png"
      const filenames = Array.from(md.matchAll(/\[img:([^\]]+)\]/g)).map((m) => m[1]);
      const body = filenames
        .map((fn) => `<ac:image><ri:attachment ri:filename="${fn}"/></ac:image>`)
        .join("");
      return Promise.resolve(asStorageXhtml(body || "<p>noop</p>"));
    },
  };
}

function makePageRepo(rec: { puts: number }): PublishDeps["pageRepo"] {
  return {
    get(_pageId: PageId): Promise<{ id: PageId; version: number; title: string } | null> {
      return Promise.resolve({ id: asPageId("1"), version: 1, title: "T" });
    },
    putStorageBody(
      pageId: PageId,
      _storage: StorageXhtml,
      _title?: string,
    ): Promise<{ id: PageId; version: number }> {
      rec.puts++;
      return Promise.resolve({ id: pageId, version: 2 });
    },
  };
}

function makeAttachRepo(rec: { ensured: string[]; listed: string[] }): PublishDeps["attachRepo"] {
  return {
    list(_pageId: PageId): Promise<readonly AttachmentInfo[]> {
      const items: AttachmentInfo[] = rec.listed.map((fn) => ({
        id: fn,
        fileName: fn,
        mediaType: "image/png",
      }));
      return Promise.resolve(items);
    },
    uploadOrHeal(
      _pageId: PageId,
      _filePath: Path,
      _fileName?: string,
      _contentType?: string,
    ): Promise<AttachmentInfo> {
      // Not used in tests
      return Promise.resolve({ id: "unused", fileName: "unused.png", mediaType: "image/png" });
    },
    ensure(_pageId: PageId, filePath: Path, contentType?: string): Promise<AttachmentInfo> {
      const fp = normalize(String(filePath));
      rec.ensured.push(fp);
      const fname = fp.split("/").pop()!;
      return Promise.resolve({ id: fname, fileName: fname, mediaType: contentType ?? "image/png" });
    },
  };
}

function makeProps(initialHash: string | null, rec: { set?: string | null }): PublishDeps["props"] {
  let current: ExportHash | null = initialHash ? makeExportHash(initialHash) : null;
  return {
    getExportHash(_pageId: PageId): Promise<ExportHash | null> {
      return Promise.resolve(current);
    },
    setExportHash(_pageId: PageId, hash: ExportHash): Promise<void> {
      rec.set = String(hash);
      current = hash;
      return Promise.resolve();
    },
  };
}

// ---- Helpers

function makeOptions(root: string, md: string, images: string): PublishSingleOptions {
  return {
    rootDir: asPath(root),
    md: asPath(md),
    images: asPath(images),
    baseUrl: asUrl("https://x.example"),
    basicAuth: { username: "u", password: "p" },
    pageId: asPageId("123"),
    title: "My Title",
  };
}

// ---- Tests

Deno.test("delta-skip path: same hash => no page update, heal missing attachments", async () => {
  const root = "/proj";
  const images = "/proj/images";
  const files: Record<string, string> = {
    "/proj": "", // dir marker
    "/proj/images": "",
    "/proj/docs/a.md": "A\n\n[img:pic1.png]\n",
    "/proj/docs/b.md": "B\n\n[img:pic2.png]\n",
    "/proj/images/pic1.png": "PNG",
    "/proj/images/pic2.png": "PNG",
    "/proj/README.md": "ignored",
  };

  const fs = makeFs(files);
  const ordering = makeOrdering(["/proj/docs/a.md", "/proj/docs/b.md"]);
  const transformerCapture: { lastInput?: string } = {};
  const transformer = makeTransformer(transformerCapture);
  const pageRepoRec = { puts: 0 };
  const pageRepo = makePageRepo(pageRepoRec);

  // Precompute matching hash using the same transformer and expected concatenation
  const expectedMd = `${files["/proj/docs/a.md"]}\n\n${files["/proj/docs/b.md"]}`;
  const preOut = await transformer.toStorage(expectedMd);
  const encoder = new TextEncoder();
  const hashBytes = await crypto.subtle.digest("SHA-256", encoder.encode(String(preOut)));
  const matchHash = Array.from(new Uint8Array(hashBytes)).map((b) => b.toString(16).padStart(2, "0")).join("");

  const propsRec: { set?: string | null } = { set: null };
  const props = makeProps(matchHash, propsRec);

  const attachRec = { ensured: [] as string[], listed: ["pic1.png"] }; // pic2 missing on server
  const attachRepo = makeAttachRepo(attachRec);

  setPublishDeps({ fs, ordering, transformer, pageRepo, attachRepo, props });

  await publishSingle(makeOptions(root, "/proj/docs/a.md", images));

  if (pageRepoRec.puts !== 0) throw new Error("Page should not be updated on delta-skip");
  if (attachRec.ensured.length !== 1 || !attachRec.ensured[0].endsWith("/proj/images/pic2.png")) {
    console.error("Ensured:", attachRec.ensured);
    throw new Error("Expected to heal exactly the missing attachment (pic2.png)");
  }
  if (propsRec.set != null) throw new Error("Property should not be set on delta-skip");
  if (!transformerCapture.lastInput?.includes("[img:pic2.png]")) {
    throw new Error("Transformer did not receive concatenated markdown");
  }
});

Deno.test("full publish path: different hash => update page, ensure attachments, set hash", async () => {
  const root = "/p2";
  const images = "/p2/images";
  const files: Record<string, string> = {
    "/p2": "",
    "/p2/images": "",
    "/p2/docs/a.md": "X\n\n[img:one.png]\n",
    "/p2/docs/b.md": "Y\n\n[img:two.png]\n",
    "/p2/images/one.png": "PNG",
    "/p2/images/two.png": "PNG",
  };

  const fs = makeFs(files);
  const ordering = makeOrdering(["/p2/docs/a.md", "/p2/docs/b.md"]);
  const transformer = makeTransformer();
  const pageRepoRec = { puts: 0 };
  const pageRepo = makePageRepo(pageRepoRec);

  const propsRec: { set?: string | null } = { set: null };
  const props = makeProps(null, propsRec);

  const attachRec = { ensured: [] as string[], listed: [] as string[] }; // nothing on server
  const attachRepo = makeAttachRepo(attachRec);

  setPublishDeps({ fs, ordering, transformer, pageRepo, attachRepo, props });

  await publishSingle(makeOptions(root, "/p2/docs/a.md", images));

  if (pageRepoRec.puts !== 1) throw new Error("Page should be updated when hash differs");
  // Both attachments should be ensured
  const ensuredNames = attachRec.ensured.map((p) => p.split("/").pop()!);
  ensuredNames.sort();
  if (JSON.stringify(ensuredNames) !== JSON.stringify(["one.png", "two.png"])) {
    console.error("Ensured:", attachRec.ensured);
    throw new Error("Expected both attachments to be ensured");
  }
  if (!propsRec.set) throw new Error("Export hash must be set after publish");
});

Deno.test("heal path: same hash, no attachments required => no calls", async () => {
  const root = "/p3";
  const images = "/p3/images";
  const files: Record<string, string> = {
    "/p3": "",
    "/p3/images": "",
    "/p3/docs/a.md": "Only text",
  };

  const fs = makeFs(files);
  const ordering = makeOrdering(["/p3/docs/a.md"]);
  const transformer = {
    toStorage(_md: string): Promise<StorageXhtml> {
      return Promise.resolve(asStorageXhtml("<p>Only text</p>"));
    },
  };

  const pageRepoRec = { puts: 0 };
  const pageRepo = makePageRepo(pageRepoRec);

  // Precompute hash for "<p>Only text</p>"
  const enc = new TextEncoder().encode("<p>Only text</p>");
  const bytes = await crypto.subtle.digest("SHA-256", enc);
  const sameHash = Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, "0")).join("");

  const propsRec: { set?: string | null } = { set: null };
  const props = makeProps(sameHash, propsRec);

  const attachRec = { ensured: [] as string[], listed: [] as string[] };
  const attachRepo = makeAttachRepo(attachRec);

  setPublishDeps({ fs, ordering, transformer, pageRepo, attachRepo, props });

  await publishSingle(makeOptions(root, "/p3/docs/a.md", images));

  if (pageRepoRec.puts !== 0) throw new Error("No update expected");
  if (attachRec.ensured.length !== 0) throw new Error("No attachments to heal");
  if (propsRec.set != null) throw new Error("Property should not be set on skip");
});
