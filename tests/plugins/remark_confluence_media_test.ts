import { assertEquals, assertStringIncludes } from "std/assert";
import remarkConfluenceMedia from "@authord/render-core/plugins/remark_confluence_media.ts";

Deno.test("remark_confluence_media: image attr block -> confluence-image with dims", async () => {
  const tree: any = {
    type: "root",
    children: [
      {
        type: "paragraph",
        children: [
          { type: "image", url: "images/pic.png", alt: "Alt" },
          { type: "text", value: "{width=120 height=80}" },
        ],
      },
    ],
  };

  await remarkConfluenceMedia()(tree);

  const para = tree.children[0];
  const img = para.children[0];
  assertEquals(img.data?.hName, "confluence-image");
  assertEquals(img.data?.hProperties?.filename, "pic.png");
  assertEquals(img.data?.hProperties?.width, "120");
  assertEquals(img.data?.hProperties?.height, "80");
  assertEquals(para.children.length, 1);
});

Deno.test("remark_confluence_media: raw HTML <img> -> @@ATTACH token", async () => {
  const tree: any = {
    type: "root",
    children: [
      { type: "html", value: `<img src="a.png" width="100" height="50"/>` },
    ],
  };

  await remarkConfluenceMedia()(tree);

  const htmlNode = tree.children[0];
  assertStringIncludes(htmlNode.value, "@@ATTACH|file=a.png|width=100|height=50@@");
});

Deno.test("remark_confluence_media: mermaid code -> confluence-image via onMermaid", async () => {
  const tree: any = {
    type: "root",
    children: [
      { type: "code", lang: "mermaid", value: "graph TD; A-->B;" },
    ],
  };

  await remarkConfluenceMedia({
    onMermaid: () => ({
      filename: "diagram.png",
      alt: "Diagram",
      width: 300,
    }),
  })(tree);

  const para = tree.children[0];
  const img = para.children[0];
  assertEquals(para.type, "paragraph");
  assertEquals(img.data?.hName, "confluence-image");
  assertEquals(img.data?.hProperties?.filename, "diagram.png");
  assertEquals(img.data?.hProperties?.width, "300");
  assertEquals(img.data?.hProperties?.alt, "Diagram");
});
