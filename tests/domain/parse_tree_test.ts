import { assertEquals } from "std/assert";
import { parseTree } from "../../lib/domain/parse/parse_tree.ts";

Deno.test("parseTree: builds toc", () => {
  const xml = `
<instance-profile id="x" name="X" start-page="intro.topic">
  <toc-element topic="intro.topic">
    <toc-element topic="deep.topic"/>
    <toc-element file="readme.md"/>
  </toc-element>
</instance-profile>`;
  const ir = parseTree(xml);
  assertEquals(ir.id, "x");
  assertEquals(ir.startPage, "intro.topic");
  assertEquals(ir.toc[0].children.length, 2);
  assertEquals(ir.toc[0].children[1].file, "readme.md");
});
