import { assertEquals } from "std/assert";
import rehypeConfluenceMedia from "../../lib/plugins/rehype-confluence-media.ts";

type HNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HNode[];
  value?: string;
};

const root = (children: HNode[] = []): HNode => ({ type: "root", children });
const el = (tagName: string, props: Record<string, unknown> = {}, children: HNode[] = []): HNode => ({
  type: "element",
  tagName,
  properties: props,
  children,
});
const txt = (value: string): HNode => ({ type: "text", value });

Deno.test("rehype_confluence_media: <img> -> <confluence-image>", async () => {
  const tree = root([
    el("img", { src: "assets/a.png", width: "120", height: "80", alt: "A" }),
  ]);

  await rehypeConfluenceMedia()(tree as any);

  const node = (tree.children ?? [])[0] as any;
  assertEquals(node.tagName, "confluence-image");
  assertEquals(node.properties?.filename, "a.png");
  assertEquals(node.properties?.width, "120");
  assertEquals(node.properties?.height, "80");
  assertEquals(node.properties?.alt, "A");
});

Deno.test("rehype_confluence_media: mermaid code-block -> confluence-image via onMermaid", async () => {
  const tree = root([
    el("code-block", { lang: "mermaid" }, [txt("graph TD; A-->B;")]),
  ]);

  await rehypeConfluenceMedia({
    onMermaid: () => ({ filename: "m.png", alt: "M", width: 400 }),
  })(tree as any);

  const node = (tree.children ?? [])[0] as any;
  assertEquals(node.tagName, "confluence-image");
  assertEquals(node.properties?.filename, "m.png");
  assertEquals(node.properties?.width, "400");
  assertEquals(node.properties?.alt, "M");
});
