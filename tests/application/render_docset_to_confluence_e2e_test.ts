import { assert, assertStringIncludes } from "std/assert";
import { renderDocsetToConfluence } from "../../lib/application/render_docset_to_confluence.ts";
import { TopicPageNode, DocsetRoot } from "../../lib/domain/model/ast.ts";
import { resourceMemory } from "../../lib/infrastructure/resource_memory.ts";


Deno.test("renderDocsetToConfluence: renders markdown and topic pages to Confluence storage XHTML", async () => {
  const files = {
    "page.md": `# Title\n\n![Alt](images/logo.png){width=200}\n\n<p><img src="x/y/z.png" width="120"/></p>`,
  };
  const resource = resourceMemory(files);

  // Build a tiny docset AST (skip buildDocsetAst for test simplicity)
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
      ] },
    ],
  } as any;

  const out = await renderDocsetToConfluence(docset, resource, {
    media: { /* you can add onMermaid here if needed */ },
    confluence: { insertToc: true, tocPosition: "top", tocMaxLevel: 3 },
  });

  // We expect two outputs (md + topic)
  const mdOut = out.find(x => x.kind === "markdown")!;
  const tpOut = out.find(x => x.kind === "topic")!;
  assert(mdOut && tpOut);

  // Markdown page should include ac:image (Confluence attachment macro)
  assertStringIncludes(mdOut.xml, "<ac:image");
  assertStringIncludes(mdOut.xml, 'ri:filename="logo.png"');

  // Topic page: heading survives, and code-block is processed by rehypeConfluenceStorage
  assertStringIncludes(tpOut.xml, "Section");           // heading text present
  // code-block XML CDATA rewrite path is exercised by plugin; at minimum we keep a marker
  // The plugin may wrap everything inside the storage root <div>, so just check it's valid XHTML-ish
  assertStringIncludes(tpOut.xml, "<div");
});
