import { assertEquals, assertExists } from "std/assert";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";

import remarkWritersideCustomElements from "../../lib/plugins/remark_writerside_custom_elements.ts";

type HNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, any>;
  children?: HNode[];
};

function findAll(node: any, predicate: (n: any) => boolean, acc: any[] = []): any[] {
  if (node && predicate(node)) acc.push(node);
  const kids = node && Array.isArray(node.children) ? node.children : [];
  for (const c of kids) findAll(c, predicate, acc);
  return acc;
}

Deno.test("pipeline parses show-structure and nested chapters", () => {
  const md = `<show-structure for="chapter" depth="2"/>
<chapter title="Chapter Title" id="chapter-id">
  <p>Paragraph text.</p>
  <chapter title="Nested Chapter" id="nested-chapter-id">
    <p>Nested paragraph text.</p>
  </chapter>
</chapter>`;

  const parser = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkDirective)
    .use(remarkWritersideCustomElements)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw);

  const tree = parser.runSync(parser.parse(md)) as HNode;

  const show = findAll(tree, (n) => n.type === "element" && n.tagName === "show-structure");
  assertEquals(show.length, 1);

  const chapters = findAll(tree, (n) => n.type === "element" && n.tagName === "chapter");
  assertEquals(chapters.length, 2);

  const nested = chapters.find((n: any) => n.properties?.id === "nested-chapter-id");
  assertExists(nested);
});
