// tests/application/toc_order_test.ts
import { assertEquals } from "std/assert";
import { renderDocsetToConfluence } from "../../lib/application/render_docset_to_confluence.ts";
import { DocsetRoot } from "../../lib/domain/model/ast.ts";


Deno.test("TOC pre-order is preserved", async () => {
  const docset: DocsetRoot = {
    type: "docset",
    data: { topicsDir: "topics", imagesDir: { dir: "images" } },
    children: [
      { type: "instances", children: [{
        type: "instance",
        data: { id: "inst", name: "Inst", startPage: "topics/a.topic" },
        children: [
          { type: "toc", data: { topic: "topics/a.topic" }, children: [
            { type: "toc", data: { file: "topics/r.md" }, children: [] },
            { type: "toc", data: { topic: "topics/b.topic" }, children: [] },
          ] },
          { type: "toc", data: { file: "topics/s.md" }, children: [] },
        ]
      }]},
      { type: "pages", children: [
        { type: "topicPage", data: { file: "topics/a.topic", id: "a", title: "A" }, children: [] },
        { type: "markdownPage", data: { file: "topics/r.md", title: "R" }, children: [] },
        { type: "topicPage", data: { file: "topics/b.topic", id: "b", title: "B" }, children: [] },
        { type: "markdownPage", data: { file: "topics/s.md", title: "S" }, children: [] },
      ]}
    ]
  } as any;

  const res = await renderDocsetToConfluence(
    docset,
    { readText: async () => "# x", resolve: (b,t)=>t, exists: async ()=>true },
    {}
  );
  const order = res.map(r => r.file);
  assertEquals(order, ["topics/a.topic","topics/r.md","topics/b.topic","topics/s.md"]);
});
