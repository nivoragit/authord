import { runConfluenceSingle } from "../lib/confluence-single.ts";
import { setPublishDeps, type PublishDeps } from "../lib/publish-single.ts";
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

// Minimal smoke test: call runConfluenceSingle with mocked deps and ensure the
// core use case is invoked (pageRepo.putStorageBody called once).

function normalize(p: string): string {
  return p.replace(/\\/g, "/");
}

function makeDeps(files: Record<string, string>, counters: { puts: number; ensured: number }): PublishDeps {
  const fs = {
    readText(p: Path): Promise<string> {
      const k = normalize(String(p));
      return Promise.resolve(files[k] ?? "");
    },
    exists(p: Path): Promise<boolean> {
      const k = normalize(String(p));
      if (k in files) return Promise.resolve(true);
      // directory?
      return Promise.resolve(Object.keys(files).some((f) => f.startsWith(k.endsWith("/") ? k : k + "/")));
    },
    glob(): Promise<readonly Path[]> {
      return Promise.resolve([] as Path[]);
    },
    list(): Promise<readonly Path[]> {
      return Promise.resolve([] as Path[]);
    },
  };

  const ordering = {
    resolve(_root: Path): Promise<readonly Path[]> {
      // Return deterministic order: a.md then b.md if present
      const list: string[] = Object.keys(files).filter((k) => k.endsWith(".md"));
      list.sort();
      return Promise.resolve(list.map((p) => asPath(p)));
    },
  };

  const transformer = {
    toStorage(md: string): Promise<StorageXhtml> {
      // Turn any [img:x.png] markers into storage references
      const fns = Array.from(md.matchAll(/\[img:([^\]]+)\]/g)).map((m) => m[1]);
      const body = fns.map((fn) => `<ac:image><ri:attachment ri:filename="${fn}"/></ac:image>`).join("") || "<p>x</p>";
      return Promise.resolve(asStorageXhtml(body));
    },
  };

  const pageRepo = {
    get(_id: PageId): Promise<{ id: PageId; version: number; title: string } | null> {
      return Promise.resolve({ id: asPageId("1"), version: 1, title: "T" });
    },
    putStorageBody(_id: PageId, _storage: StorageXhtml, _title?: string): Promise<{ id: PageId; version: number }> {
      counters.puts++;
      return Promise.resolve({ id: asPageId("1"), version: 2 });
    },
  };

  const attachRepo = {
    list(_id: PageId): Promise<readonly AttachmentInfo[]> {
      return Promise.resolve([]);
    },
    uploadOrHeal(): Promise<AttachmentInfo> {
      throw new Error("unused");
    },
    ensure(_id: PageId, _file: Path): Promise<AttachmentInfo> {
      counters.ensured++;
      return Promise.resolve({ id: "x", fileName: "x.png", mediaType: "image/png" });
    },
  };

  const props = {
    getExportHash(): Promise<any> {
      return Promise.resolve(null);
    },
    setExportHash(): Promise<void> {
      return Promise.resolve();
    },
  };

  return { fs, ordering, transformer, pageRepo, attachRepo, props } as unknown as PublishDeps;
}

Deno.test("confluence-single wiring: invokes publishSingle with provided options", async () => {
  const root = await Deno.makeTempDir({ prefix: "authord-cli-" });
  try {
    const files: Record<string, string> = {};
    // Simulate project tree in "virtual" FS used by deps
    const a = `${root}/topics/a.md`;
    const b = `${root}/topics/b.md`;
    const imgDir = `${root}/images`;
    files[normalize(root)] = "";
    files[normalize(`${root}/topics`)] = "";
    files[normalize(imgDir)] = "";
    files[normalize(a)] = "Hello [img:one.png]";
    files[normalize(b)] = "World [img:two.png]";
    files[normalize(`${imgDir}/one.png`)] = "PNG";
    files[normalize(`${imgDir}/two.png`)] = "PNG";

    const counters = { puts: 0, ensured: 0 };
    const deps = makeDeps(files, counters);

    const opts: PublishSingleOptions = {
      rootDir: asPath(root),
      md: asPath(`${root}/topics/a.md`),
      images: asPath(imgDir),
      baseUrl: asUrl("https://conf.example"),
      basicAuth: { username: "u", password: "p" },
      pageId: asPageId("12345"),
      title: "From CLI",
    };

    // Inject mocked deps and run
    setPublishDeps(deps);
    await runConfluenceSingle(opts, deps);

    if (counters.puts !== 1) throw new Error(`Expected page update once, got ${counters.puts}`);
    if (counters.ensured !== 2) throw new Error(`Expected 2 attachments ensured, got ${counters.ensured}`);
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});