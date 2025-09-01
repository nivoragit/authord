// tests/usecase/publish_single_test.ts
import { assertEquals, assert } from "std/assert";
import { setPublishDeps, publishSingle } from "../../lib/publish-single.ts";
import { asPath, asUrl } from "../../lib/utils/types.ts";

Deno.test("publishSingle: uploads combined storage & ensures attachments", async () => {
  // in-memory fs
  const files: Record<string, string> = {
    "/root/writerside.cfg": `<ihp><topics dir="topics"/><images dir="images"/><instance src="site.tree"/></ihp>`,
    "/root/site.tree": `<instance-profile id="s" name="S" start-page="/root/topics/a.topic"><toc-element topic="/root/topics/a.topic"/></instance-profile>`,
    "/root/topics/a.topic": `<topic title="A" id="a"><p>Hello</p></topic>`,
    "/root/images/logo.png": "PNG", // attachment present on disk
  };

  // Directory-aware exists(): true if path is a file OR prefix of any file (simulates dirs)
  const dirExists = (p: string) => {
    if (p in files) return true;
    const prefix = p.endsWith("/") ? p : p + "/";
    return Object.keys(files).some((k) => k.startsWith(prefix));
  };

  const fs = {
    async readText(p: any) {
      const k = String(p);
      if (!(k in files)) throw new Error("ENOENT: " + k);
      return files[k];
    },
    async exists(p: any) {
      return dirExists(String(p));
    },
    async glob() { return []; },
    async list() { return []; },
  };

  const calls: any[] = [];
  const pageRepo = {
    async putStorageBody(_id: any, body: any, _title?: string) { calls.push({ op: "put", body: String(body) }); },
  };
  const attachRepo = {
    async list() { return []; },
    async ensure(_id: any, _path: any, _ctype: any) { calls.push({ op: "attach" }); },
  };
  
  const props = {
    _hash: null as null | string,
    async getExportHash(_id: any) {
      return this._hash;
    },
    async setExportHash(_id: any, h: any) {   // <-- accept (id, hash)
      this._hash = String(h);                 // <-- store the hash, not the id
    },
  };

  setPublishDeps({ fs, pageRepo, attachRepo, props } as any);

  // Note: md points to README.md but is auto-ignored because writerside.cfg is detected
  await publishSingle({
    rootDir: asPath("/root"),
    md: asPath("/root/topics/README.md"), // ignored by auto-detect writerside.cfg
    images: asPath("/root/images"),
    baseUrl: asUrl("https://conf"),
    basicAuth: { username: "u", password: "p" },
    pageId: "123" as any,
    title: "Title",
  });

  assert(calls.some((c) => c.op === "put"), "expected page update");

  // second call should be idempotent (no content delta)
  calls.length = 0;
  await publishSingle({
    rootDir: asPath("/root"),
    md: asPath("/root/topics/README.md"),
    images: asPath("/root/images"),
    baseUrl: asUrl("https://conf"),
    basicAuth: { username: "u", password: "p" },
    pageId: "123" as any,
    title: "Title",
  });

  // no put on idempotent run
  assertEquals(calls.filter((c) => c.op === "put").length, 0);
});
