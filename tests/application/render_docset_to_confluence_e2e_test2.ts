// tests/application/render_docset_to_confluence_e2e_test.ts
import { assert, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderDocsetToConfluence } from "../../lib/application/render_docset_to_confluence.ts";
import { TopicPageNode, DocsetRoot } from "../../lib/domain/model/ast.ts";

Deno.test("renderDocsetToConfluence: renders markdown and topic pages to Confluence storage XHTML", async () => {
  const files = new Map<string, string>([
    ["page.md", `# Title\n\n![Alt](images/logo.png){width=200}`],
  ]);

  const resource = {
    async readText(p: string) { return files.get(p) ?? ""; },
    resolve: (_b: string, t: string) => t,
    async exists(p: string) { return files.has(p); },
  };

  const topicPage: TopicPageNode = {
    type: "topicPage",
    data: { file: "/topics/a.topic", id: "a", title: "A" },
    children: [
      { type: "chapter", data: { id: "sec", title: "Section" }, children: [
        { type:"paragraph", children:[{ type:"text", value:"Text"}] },
        { type:"codeBlock", data: { lang: "xml", content: "<img src='a.png'/>" }, children: [] },
      ]},
    ],
  };

  const docset: DocsetRoot = {
    type: "docset",
    data: { topicsDir: "topics", imagesDir: { dir: "images" } },
    children: [
      { type: "instances", children: [] },
      { type: "pages", children: [
        { type: "markdownPage", data: { file: "page.md" }, children: [] },
        topicPage
      ]},
    ],
  } as any;

  const out = await renderDocsetToConfluence(docset, resource as any, {
    media: {},
    confluence: { insertToc: true, tocPosition: "top", tocMaxLevel: 3 },
  });

  const mdOut = out.find(x => x.kind === "markdown")!;
  const tpOut = out.find(x => x.kind === "topic")!;
  assert(mdOut && tpOut);

  // Markdown → <ac:image ri:filename="logo.png">
  assertStringIncludes(mdOut.xml, "<ac:image");
  assertStringIncludes(mdOut.xml, 'ri:filename="logo.png"');

  // Topic: heading present; plugin wraps with storage root div
  assertStringIncludes(tpOut.xml, "Section");
  assertStringIncludes(tpOut.xml, "<div");
});
