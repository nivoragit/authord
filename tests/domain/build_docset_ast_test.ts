// tests/application/build_docset_ast_test.ts
import { assertEquals } from "std/assert";
import { resourceMemory } from "../../lib/infrastructure/resource_memory.ts";
import { buildDocsetAst } from "../../lib/application/build_docset_ast.ts";

Deno.test("buildDocsetAst end-to-end (includes + code)", async () => {
  const fs = resourceMemory({
    "writerside.cfg": `<ihp><topics dir="topics"/><images dir="images"/><instance src="site.tree"/></ihp>`,
    "site.tree": `<instance-profile id="s" name="Site" start-page="topics/a.topic"><toc-element topic="topics/a.topic"/></instance-profile>`,
    "topics/a.topic": `<topic title="A" id="a"><include from="lib.topic" element-id="s1"/><code-block src="code.txt" include-lines="1-2"/></topic>`,
    "topics/lib.topic": `<topic title="Lib" id="lib" is-library="true"><snippet id="s1"><p>HELLO</p></snippet></topic>`,
    "topics/code.txt": "X1\nX2\nX3"
  });

  const ast = await buildDocsetAst({ cfgPath: "writerside.cfg", resource: fs });
  const pages = ast.children[1] as any;
  const tp = pages.children.find((n: any) => n.type === "topicPage");
  const para = tp.children[0];
  const code = tp.children[1];

  assertEquals(para.type, "paragraph");
  assertEquals(para.children[0].value, "HELLO");
  assertEquals(code.type, "codeBlock");
  assertEquals(code.data.content, "X1\nX2");
});
