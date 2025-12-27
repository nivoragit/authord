// deno-lint-ignore-file no-explicit-any
import { assertStringIncludes } from "std/assert";
import type { Element as XEl } from "xast";
import type { IMarkdownTransformer } from "../../lib/ports/ports.ts";
import { unified } from "unified";
import rehypeStringify from "rehype-stringify";
import { ConfluenceStorageRenderer } from "../../lib/application/confluence_storage_renderer.ts";

function xel(name: string, attrs: Record<string, unknown> = {}, children: any[] = []): XEl {
  return { type: "element", name, attributes: attrs, children } as unknown as XEl;
}
function txt(v: string) { return { type: "text", value: v } as any; }

class FakeMarkdown implements IMarkdownTransformer {
  async toStorage(markdown: string) {
    // Return an easily-recognizable XHTML wrapper so we can assert routing.
    return { type: "storage-xhtml", value: `<div data-md="1">${markdown}</div>` } as any;
  }
}

// Helper to stringify a HAST tree without using .process(...)
async function stringifyAst(tree: any): Promise<string> {
  const proc = unified().use(rehypeStringify, {
    allowDangerousHtml: true,
    closeSelfClosing: true,
    tightSelfClosing: true,
  });
  const transformed = await proc.run(tree as any);      // no parser; operate on AST
  return String(proc.stringify(transformed as any));    // compile to HTML string
}

Deno.test("ConfluenceStorageRenderer: renders both topic and markdown pages", async () => {
  const topicAst = xel("topic", {}, [
    xel("title", {}, [txt("T")]),
    xel("p", {}, [txt("Hello")]),
  ]);

  const mdAst = xel("md-page", { src: "/x.md" }, [txt("# H1\n\ntext")]);

  const docset = {
    type: "docset",
    data: { cfg: {} as any },
    instances: [],
    pages: [
      { path: "/topic1.topic", kind: "topic" as const, ast: topicAst },
      { path: "/readme.md", kind: "markdown" as const, ast: mdAst },
    ],
  };

  const r = new ConfluenceStorageRenderer({ markdown: new FakeMarkdown() },"");
  const pages = await r.renderDocset(docset as any);

  // topic page should become Storage XHTML with <h1>T</h1><p>Hello</p>
  const t = pages.find((p) => p.path.endsWith(".topic"))!;
  const s = String((t.xhtml as any).value ?? (t.xhtml as any));
  assertStringIncludes(s, "<h1>T</h1>");
  assertStringIncludes(s, "<p>Hello</p>");

  // markdown page must be routed through FakeMarkdown
  const m = pages.find((p) => p.path.endsWith(".md"))!;
  const ms = String((m.xhtml as any).value ?? (m.xhtml as any));
  assertStringIncludes(ms, `data-md="1"># H1`);
});

Deno.test("ConfluenceStorageRenderer: topic to AST (not string) API", async () => {
  const topicAst = xel("topic", {}, [
    xel("title", {}, [txt("Head")]),
    xel("image", { src: "z.png", width: 123 }, []),
  ]);

  const r = new ConfluenceStorageRenderer({ markdown: new FakeMarkdown() },"");
  const storageAst = await r.toStorageAstForTopic(topicAst);

  // After plugin, root children get wrapped in a single div with xmlns props
  const rootChildren = storageAst.children!;
  const first = rootChildren[0] as any;
  if (!(first && first.type === "element" && first.tagName === "div")) {
    throw new Error("expected top-level wrapper div");
  }

  // Stringify the storage AST safely (no parser)
  const s = await stringifyAst(storageAst);

  // contains the attachment image produced downstream from <img>
  if (!s.includes(`ri:filename="z.png"`)) {
    throw new Error('expected ac:image/ri:attachment for z.png');
  }
});
