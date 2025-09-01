import { assertEquals } from "std/assert";
import { parseTopic } from "../../lib/domain/parse/parse_topic.ts";

Deno.test("parseTopic: chapters, snippet, include, code-block", () => {
  const xml = `
<topic title="T" id="t">
  <chapter title="C1" id="c1">
    <p>Hello <a href="x.topic#y">X</a></p>
    <code-block lang="bash">echo hi</code-block>
  </chapter>
  <snippet id="s1"><p>S</p></snippet>
  <include from="lib.topic" element-id="s1"/>
</topic>`;
  const page = parseTopic(xml, "/t.topic");
  assertEquals(page.data.title, "T");
  const ch = page.children.find(n => n.type === "chapter")!;
  assertEquals((ch as any).data.id, "c1");
  const inc = page.children.find(n => n.type === "includeMarker")!;
  assertEquals((inc as any).data.elementId, "s1");
});
