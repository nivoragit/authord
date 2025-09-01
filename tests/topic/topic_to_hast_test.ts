import { assertEquals, assert } from "std/assert";
import { TopicPageNode } from "../../lib/domain/model/ast.ts";
import { topicToHast } from "../../lib/topic/topic_to_hast.ts";


Deno.test("topicToHast: chapters, paragraphs, lists, tables, code-blocks", () => {
  const topic: TopicPageNode = {
    type: "topicPage",
    data: { file: "/t.topic", id: "t", title: "T" },
    children: [
      { type: "chapter", data: { id: "c1", title: "Heading 1" }, children: [
        { type: "paragraph", children: [{ type:"text", value:"Hello " }, { type:"link", data:{ href:"/x" }, children:[{ type:"text", value:"world"}] }] },
        { type: "list", data: { ordered: false }, children: [
          { type: "listItem", children: [{ type:"paragraph", children: [{ type:"text", value:"Item"}]}] }
        ]},
        { type: "table", children: [
          { type: "tableRow", children: [
            { type: "tableCell", children: [{ type:"paragraph", children:[{ type:"text", value:"A"}]}] },
            { type: "tableCell", children: [{ type:"paragraph", children:[{ type:"text", value:"B"}]}] },
          ]}
        ]},
        { type: "codeBlock", data: { lang:"xml", content:"<img src=\"a.png\"/>" }, children: [] },
      ]},
    ],
  };

  const hast = topicToHast(topic);
  assertEquals(hast.type, "root");
  const h2 = (hast.children[0] as any);
  assertEquals(h2.tagName, "h2");
  assertEquals(h2.children[0].value, "Heading 1");

  const p = hast.children.find((n: any) => n.tagName === "p") as any;
  assert(p);
  assertEquals(p.children[0].value, "Hello ");

  const a = p.children[1];
  assertEquals(a.tagName, "a");
  assertEquals(a.properties.href, "/x");
  assertEquals(a.children[0].value, "world");

  const code = hast.children.find((n: any) => n.tagName === "code-block") as any;
  assertEquals(code.properties.lang, "xml");
  assertEquals(code.children[0].value, "<img src=\"a.png\"/>");
});
