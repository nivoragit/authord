// tests/application/render_order_test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderDocsetToConfluence } from "../../lib/application/render_docset_to_confluence.ts";

Deno.test("orderedPages: respects TOC and appends unattached", async () => {
  const docset: any = {
    type: "docset",
    data: {},
    children: [
      { type: "instances", children: [
        { type: "instance", data: {}, children: [
          { type: "toc", data: { topic: "/a.md" }, children: [] },
          { type: "toc", data: { topic: "/b.topic" }, children: [] },
        ]},
      ]},
      { type: "pages", children: [
        { type: "markdownPage", data: { file: "/a.md" }, children: [] },
        { type: "topicPage",    data: { file: "/b.topic", id:"b", title:"B" }, children: [] },
        { type: "markdownPage", data: { file: "/extra.md" }, children: [] }, // unattached
      ]},
    ],
  };

  const resource = {
    async readText(p: string) {
      if (p === "/a.md") return "# A";
      if (p === "/extra.md") return "E";
      return "";
    },
    resolve: (_b: string, t: string) => t,
    async exists(_p: string) { return true; },
  };

  const out = await renderDocsetToConfluence(docset, resource as any);
  assertEquals(out.map(x => x.file), ["/a.md", "/b.topic", "/extra.md"]);
});
