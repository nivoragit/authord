import { assertStringIncludes } from "std/assert";
import { unified } from "unified";
import remarkParse from "remark-parse";

import remarkWritersideCustomElements from "../../lib/plugins/remark_writerside_custom_elements.ts";

Deno.test("remark_writerside_custom_elements expands self-closing tags", () => {
  const md = [
    '<show-structure for="chapter" depth="2"/>',
    '<include from="x.md" />',
    "<link-summary/>",
    "<card-summary />",
  ].join("\n");

  const processor = unified().use(remarkParse).use(remarkWritersideCustomElements);
  const tree = processor.runSync(processor.parse(md)) as any;

  const htmlNodes = (tree.children || []).filter((n: any) => n.type === "html");
  const joined = htmlNodes.map((n: any) => n.value).join("\n");

  assertStringIncludes(
    joined,
    '<show-structure for="chapter" depth="2"></show-structure>',
  );
  assertStringIncludes(joined, '<include from="x.md"');
  assertStringIncludes(joined, "</include>");
  assertStringIncludes(joined, "<link-summary>");
  assertStringIncludes(joined, "</link-summary>");
  assertStringIncludes(joined, "<card-summary");
  assertStringIncludes(joined, "</card-summary>");
});
