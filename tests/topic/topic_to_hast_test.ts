// deno-lint-ignore-file no-explicit-any
import { assertStringIncludes } from "std/assert";
import { unified } from "unified";
import type { Element as XEl } from "xast";
import rehypeStringify from "rehype-stringify";
import rehypeConfluenceStorage from "../../lib/plugins/rehype_confluence_storage.ts";
import { TopicXastToHast } from "../../lib/topic/topic_to_hast.ts";

function xel(name: string, attrs: Record<string, unknown> = {}, children: any[] = []): XEl {
  return { type: "element", name, attributes: attrs, children } as unknown as XEl;
}
function txt(v: string) {
  return { type: "text", value: v } as any;
}
function cdata(v: string) {
  return { type: "cdata", value: v } as any;
}

async function renderHtml(hast: any) {
  const proc = unified()
    .use(rehypeConfluenceStorage)
    .use(rehypeStringify, {
      allowDangerousHtml: true,
      closeSelfClosing: true,
      tightSelfClosing: true,
    });

  // run on AST then stringify
  const transformed = await proc.run(hast as any);
  return String(proc.stringify(transformed as any));
}

Deno.test("headings: title->h1, section/title->h2", async () => {
  const topic = xel("topic", {}, [
    xel("title", {}, [txt("Root")]),
    xel("section", {}, [
      xel("title", {}, [txt("Child")]),
      xel("p", {}, [txt("Body")]),
    ]),
  ]);
  const html = await renderHtml(new TopicXastToHast().toHast(topic));
  assertStringIncludes(html, "<h1>Root</h1>");
  assertStringIncludes(html, "<h2>Child</h2>");
  assertStringIncludes(html, "<p>Body</p>");
});

Deno.test("chapter: h{2+depth} fallback path", async () => {
  const topic = xel("topic", {}, [
    xel("chapter", { id: "c1" }, [
      xel("title", {}, [txt("Chap 1")]),
      xel("chapter", {}, [xel("title", {}, [txt("Chap 1.1")])]),
    ]),
  ]);
  const html = await renderHtml(new TopicXastToHast().toHast(topic));
  assertStringIncludes(html, `<h2 id="c1">Chap 1</h2>`);
  assertStringIncludes(html, `<h3>Chap 1.1</h3>`);
});

Deno.test("format: role-based then style", async () => {
  const topic = xel("topic", {}, [
    xel("p", {}, [
      xel("format", { role: "strong" }, [txt("A")]),
      txt(" "),
      xel("format", { style: "color:red" }, [txt("B")]),
    ]),
  ]);
  const html = await renderHtml(new TopicXastToHast().toHast(topic));
  assertStringIncludes(html, "<strong>A</strong>");
  assertStringIncludes(html, `<span style="color:red">B</span>`);
});

Deno.test("spotlight block", async () => {
  const topic = xel("topic", {}, [xel("spotlight", {}, [xel("p", {}, [txt("Hi")])])]);
  const html = await renderHtml(new TopicXastToHast().toHast(topic));
  assertStringIncludes(html, `<div class="spotlight"><p>Hi</p>`);
});

Deno.test("code-block props passthrough", async () => {
  const topic = xel("topic", {}, [
    xel(
      "code-block",
      {
        lang: "xml",
        "collapsed-title": "More",
        collapsible: "true",
        "include-lines": "1-3",
        src: "a.xml",
      },
      [txt("<![CDATA[<img src='x.png' width='10'/>]]>")],
    ),
  ]);
  const html = await renderHtml(new TopicXastToHast().toHast(topic));
  assertStringIncludes(html, `<ac:parameter ac:name="title">More</ac:parameter>`);
  assertStringIncludes(html, `<ac:parameter ac:name="collapse">false</ac:parameter>`);
  assertStringIncludes(html, `<ac:parameter ac:name="language">xml</ac:parameter>`);
  assertStringIncludes(html, "x.png");
  if (html.includes("@@ATTACH|file=")) {
    throw new Error("Expected no @@ATTACH placeholder in XML code block");
  }
});

Deno.test("code-block preserves CDATA content", async () => {
  const topic = xel("topic", {}, [
    xel("code-block", { lang: "xml" }, [
      cdata("<img src='x.png' width='10'/>"),
    ]),
  ]);
  const html = await renderHtml(new TopicXastToHast().toHast(topic));
  assertStringIncludes(html, "x.png");
});

Deno.test("images become ac:image downstream", async () => {
  const topic = xel("topic", {}, [xel("p", {}, [xel("img", { src: "diagram.png", width: "200" }, [])])]);
  const html = await renderHtml(new TopicXastToHast().toHast(topic));
  assertStringIncludes(html, `ri:filename="diagram.png"`);
  assertStringIncludes(html, `ac:width="200"`);
});
