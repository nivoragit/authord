// deno-lint-ignore-file no-explicit-any
import {
  assertEquals,
  assertStringIncludes,
  assert,
} from "std/assert";
import type { Element as XEl } from "xast";
import { SinglePageComposer } from "../../lib/core/application/single_page_composer.ts";

// ───────────── helpers ─────────────
function xel(name: string, attrs: Record<string, unknown> = {}, children: any[] = []): XEl {
  return { type: "element", name, attributes: attrs, children } as unknown as XEl;
}
function txt(v: string) { return { type: "text", value: v } as any; }
const storage = (s: string) => ({ type: "storage-xhtml", value: s } as any);

// Fake renderer that returns predefined XHTML per page.path
class FakeRenderer {
  constructor(private readonly byPathHtml: Record<string, string>) {}
  async renderDocset(docset: any) {
    return docset.pages.map((p: any) => ({
      path: p.path,
      media: "storage-xhtml",
      xhtml: storage(this.byPathHtml[p.path] ?? `<p>${p.path}</p>`),
    }));
  }
  async toStorageAstForTopic(_topic: XEl) {
    throw new Error("not needed here");
  }
}

// Minimal markdown transformer to satisfy ctor
class FakeMarkdown {
  async toStorage(markdown: string) {
    return storage(`<div data-md="1">${markdown}</div>`);
  }
}

// Extract the composed HTML string for assertions
function asHtmlString(x: any): string {
  return (x?.value ?? x) as string;
}

// Count occurrences of a substring
function countOf(hay: string, needle: string): number {
  let i = 0, c = 0;
  for (;;) {
    const k = hay.indexOf(needle, i);
    if (k < 0) break;
    c++; i = k + needle.length;
  }
  return c;
}

// ───────────── fixtures ─────────────
function buildDocsetWithInstance(): any {
  // Pages
  const topicA = xel("topic", {}, [xel("title", {}, [txt("Alpha")]), xel("p", {}, [txt("A body")])]);
  const topicB = xel("topic", {}, [xel("title", {}, [txt("Beta")]), xel("p", {}, [txt("B body")])]);
  const md = xel("md-page", { src: "/docs/readme.md" }, [txt("# H1\n\ntext")]);

  // Instance with TOC order: alpha.topic -> beta.topic
  const inst = xel("instance", {}, [
    xel("toc", {}, [
      xel("toc-element", { topic: "alpha.topic" }, []),
      xel("toc-element", { topic: "beta.topic" }, []),
    ]),
  ]);

  return {
    type: "docset",
    data: { cfg: {} },
    instances: [{ path: "/i.xml", ast: inst }],
    pages: [
      { path: "/docs/topics/alpha.topic", kind: "topic" as const, ast: topicA },
      { path: "/docs/topics/beta.topic", kind: "topic" as const, ast: topicB },
      { path: "/docs/readme.md", kind: "markdown" as const, ast: md },
    ],
  };
}

function buildDocsetNoInstance(): any {
  const t1 = xel("topic", {}, [xel("title", {}, [txt("One")])]);
  const t2 = xel("topic", {}, [xel("title", {}, [txt("Two")])]);
  return {
    type: "docset",
    data: { cfg: {} },
    instances: [],
    pages: [
      { path: "/p/one.topic", kind: "topic" as const, ast: t1 },
      { path: "/p/two.topic", kind: "topic" as const, ast: t2 },
    ],
  };
}

// ───────────── tests ─────────────

Deno.test("orders by first instance TOC; remaining pages appended", async () => {
  const docset = buildDocsetWithInstance();

  const fakeRenderer = new FakeRenderer({
    "/docs/topics/alpha.topic": `<p>A</p>`,
    "/docs/topics/beta.topic": `<p>B</p>`,
    "/docs/readme.md": `<p>MD</p>`,
  });

  const composer = new SinglePageComposer(fakeRenderer as any, new FakeMarkdown() as any);
  const page = await composer.build(docset, {
    title: "All-in-one",
    insertToc: false,
  });

  const html = asHtmlString(page.storageHtml);

  // The order should be: alpha, beta, then readme (not referenced in TOC)
  const aPos = html.indexOf(`<h2 id="sec-alpha">Alpha</h2>`);
  const bPos = html.indexOf(`<h2 id="sec-beta">Beta</h2>`);
  const mdPos = html.indexOf(`<h2 id="sec-readme">readme</h2>`);
  assert(aPos >= 0 && bPos > aPos && mdPos > bPos, "sections should follow A -> B -> readme order");

  // Each section should include its body immediately after heading
  assertStringIncludes(html, `<h2 id="sec-alpha">Alpha</h2>\n<p>A</p>`);
  assertStringIncludes(html, `<h2 id="sec-beta">Beta</h2>\n<p>B</p>`);
  assertStringIncludes(html, `<h2 id="sec-readme">readme</h2>\n<p>MD</p>`);
});

Deno.test("fallback order equals docset.pages when no instance", async () => {
  const docset = buildDocsetNoInstance();

  const fakeRenderer = new FakeRenderer({
    "/p/one.topic": `<p>1</p>`,
    "/p/two.topic": `<p>2</p>`,
  });

  const composer = new SinglePageComposer(fakeRenderer as any, new FakeMarkdown() as any);
  const page = await composer.build(docset, { title: "Flat", insertToc: false });

  const html = asHtmlString(page.storageHtml);
  const oneIndex = html.indexOf(`<h2 id="sec-one">One</h2>`);
  const twoIndex = html.indexOf(`<h2 id="sec-two">Two</h2>`);
  assert(oneIndex >= 0 && twoIndex > oneIndex, "fallback order should be preserved");
});

Deno.test("inserts TOC macro when requested", async () => {
  const docset = buildDocsetNoInstance();
  const fakeRenderer = new FakeRenderer({
    "/p/one.topic": `<p>1</p>`,
    "/p/two.topic": `<p>2</p>`,
  });
  const composer = new SinglePageComposer(fakeRenderer as any, new FakeMarkdown() as any);
  const page = await composer.build(docset, { title: "TOC", insertToc: true });

  const html = asHtmlString(page.storageHtml);
  assertStringIncludes(html, `<ac:structured-macro ac:name="toc"`);
});

Deno.test("does not insert TOC when disabled", async () => {
  const docset = buildDocsetNoInstance();
  const fakeRenderer = new FakeRenderer({
    "/p/one.topic": `<p>1</p>`,
    "/p/two.topic": `<p>2</p>`,
  });
  const composer = new SinglePageComposer(fakeRenderer as any, new FakeMarkdown() as any);
  const page = await composer.build(docset, { title: "NoTOC", insertToc: false });

  const html = asHtmlString(page.storageHtml);
  assertEquals(html.includes(`<ac:structured-macro ac:name="toc"`), false);
});

Deno.test("customizes section heading level and anchor id", async () => {
  const docset = buildDocsetWithInstance();
  const fakeRenderer = new FakeRenderer({
    "/docs/topics/alpha.topic": `<p>A</p>`,
    "/docs/topics/beta.topic": `<p>B</p>`,
    "/docs/readme.md": `<p>MD</p>`,
  });

  const composer = new SinglePageComposer(fakeRenderer as any, new FakeMarkdown() as any);
  const page = await composer.build(docset, {
    title: "H3",
    insertToc: false,
    sectionHeadingLevel: 3,
  });

  const html = asHtmlString(page.storageHtml);
  assertStringIncludes(html, `<h3 id="sec-alpha">Alpha</h3>`);
  assertStringIncludes(html, `<h3 id="sec-beta">Beta</h3>`);
  // md page uses filename as heading text
  assertStringIncludes(html, `<h3 id="sec-readme">readme</h3>`);
});

Deno.test("inserts separators between sections when requested", async () => {
  const docset = buildDocsetNoInstance();
  const fakeRenderer = new FakeRenderer({
    "/p/one.topic": `<p>1</p>`,
    "/p/two.topic": `<p>2</p>`,
  });
  const composer = new SinglePageComposer(fakeRenderer as any, new FakeMarkdown() as any);
  const page = await composer.build(docset, {
    title: "Sep",
    insertToc: false,
    insertSeparators: true,
  });

  const html = asHtmlString(page.storageHtml);
  // With 2 sections, our composer currently emits 2 <hr/> (after each section).
  assertEquals(countOf(html, "<hr/>"), 2);
});

Deno.test("attachment resolver collects unique filenames across sections", async () => {
  const docset = buildDocsetWithInstance();

  // Each page references attachments; 'a.png' repeated across two pages
  const fakeRenderer = new FakeRenderer({
    "/docs/topics/alpha.topic": `<ac:image><ri:attachment ri:filename="a.png" /></ac:image>`,
    "/docs/topics/beta.topic": `<ac:image><ri:attachment ri:filename="b.svg" /></ac:image>`,
    "/docs/readme.md": `<ac:image><ri:attachment ri:filename="a.png" /></ac:image>`,
  });

  const resolved: Record<string, any> = {
    "a.png": { filePath: "/abs/assets/a.png", contentType: "image/png" },
    "b.svg": { filePath: "/abs/assets/b.svg", contentType: "image/svg+xml" },
  };

  const composer = new SinglePageComposer(fakeRenderer as any, new FakeMarkdown() as any);
  const page = await composer.build(docset, {
    title: "WithAttachments",
    insertToc: false,
    resolveAttachment: (fn) => resolved[fn] ?? null,
  });

  // Expect only 2 unique uploads (a.png & b.svg)
  assertEquals(page.attachments?.length ?? 0, 2);
  const fp = (page.attachments ?? []).map(a => a.filePath).sort();
  assertEquals(fp, ["/abs/assets/a.png", "/abs/assets/b.svg"]);
});

Deno.test("title selection: topic <title> preferred; md falls back to filename", async () => {
  const docset = buildDocsetWithInstance();
  const fakeRenderer = new FakeRenderer({
    "/docs/topics/alpha.topic": `<p>A</p>`,
    "/docs/topics/beta.topic": `<p>B</p>`,
    "/docs/readme.md": `<p>MD</p>`,
  });

  const composer = new SinglePageComposer(fakeRenderer as any, new FakeMarkdown() as any);
  const page = await composer.build(docset, { title: "Titles", insertToc: false });

  const html = asHtmlString(page.storageHtml);
  // From topic <title>
  assertStringIncludes(html, `<h2 id="sec-alpha">Alpha</h2>`);
  assertStringIncludes(html, `<h2 id="sec-beta">Beta</h2>`);
  // From md filename
  assertStringIncludes(html, `<h2 id="sec-readme">readme</h2>`);
});

Deno.test("returns a ConfluencePage with provided title", async () => {
  const docset = buildDocsetNoInstance();
  const fakeRenderer = new FakeRenderer({
    "/p/one.topic": `<p>1</p>`,
    "/p/two.topic": `<p>2</p>`,
  });
  const composer = new SinglePageComposer(fakeRenderer as any, new FakeMarkdown() as any);
  const page = await composer.build(docset, { title: "Export Title", insertToc: false });

  assertEquals(page.title, "Export Title");
  assert(page.storageHtml != null, "storageHtml should be present");
});
