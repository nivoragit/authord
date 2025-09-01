// tests/domain/resolve_code_blocks_test.ts
import { assertEquals } from "std/assert";
import { resolveCodeBlocks } from "../../lib/domain/resolve/resolve_code_blocks.ts";
import { TopicPageNode } from "../../lib/domain/model/ast.ts";

Deno.test("code blocks: fetch + slice", async () => {
  const page: TopicPageNode = {
    type:"topicPage", data:{file:"/t.topic", id:"t", title:"t"},
    children:[{ type:"codeBlock", data:{ src:"code.txt", includeLines:"2-3" }, children:[] }]
  };
  await resolveCodeBlocks(page, async (_owner, _src) => "L1\nL2\nL3\nL4");
  const cb = page.children[0] as any;
  assertEquals(cb.data.content, "L2\nL3");
});
