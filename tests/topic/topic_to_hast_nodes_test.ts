import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { topicToHast } from "../../lib/topic/topic_to_hast.ts";
import type {
  TopicPageNode,
  ChapterNode,
  ParagraphNode,
  NoteNode,
  ListNode,
  ListItemNode,
  TableNode,
  TableRowNode,
  TableCellNode,
  CodeBlockNode,
  FormatNode,
  LinkNode,
  SpotlightNode,
  TextNode,
} from "../../lib/domain/model/ast.ts";

/** helper: build a minimal topic and convert */
function renderBlocks(children: any[]) {
  const page: TopicPageNode = {
    type: "topicPage",
    data: { file: "/t.topic", id: "t", title: "T" },
    children: children as any,
  };
  return topicToHast(page);
}

Deno.test("chapter: heading levels and ids (h2 top-level, then h3/h4…)", () => {
  const ch3: ChapterNode = { type: "chapter", data: { id: "c3", title: "H3" }, children: [] };
  const ch2: ChapterNode = { type: "chapter", data: { id: "c2", title: "H2" }, children: [ch3] };
  const ch1: ChapterNode = { type: "chapter", data: { id: "c1", title: "H1" }, children: [ch2] };

  const page: TopicPageNode = {
    type: "topicPage",
    data: { file: "/t.topic", id: "t", title: "T" },
    children: [ch1],
  };

  const hast = topicToHast(page);

  // Filter and assert we actually have three headings
  const headings: any[] = (hast.children as any[]).filter(
    (n) => typeof n?.tagName === "string" && /^h[1-6]$/.test(n.tagName),
  );
  assertEquals(headings.length, 3);

  const h2: any = headings[0];
  const h3: any = headings[1];
  const h4: any = headings[2];

  // Now it's safe to access nested props
  assertEquals(h2.tagName, "h2");
  assertEquals(h2.properties.id, "c1");
  assertEquals(h2.children[0].value, "H1");

  assertEquals(h3.tagName, "h3");
  assertEquals(h3.properties.id, "c2");

  assertEquals(h4.tagName, "h4");
  assertEquals(h4.properties.id, "c3");
});

Deno.test("paragraph: text + link + format(style)", () => {
  const link: LinkNode = {
    type: "link",
    data: { href: "/x", summary: "tooltip" },
    children: [{ type: "text", value: "click" }],
  };
  const fmt: FormatNode = {
    type: "format",
    data: { style: "color:red" },
    children: [{ type: "text", value: "hot" }],
  };
  const p: ParagraphNode = {
    type: "paragraph",
    children: [{ type: "text", value: "Hello " }, link, fmt],
  };

  const hast = renderBlocks([p]);
  const para = hast.children[0] as any;
  assertEquals(para.tagName, "p");

  const [t0, a, span] = para.children;
  assertEquals(t0.value, "Hello ");
  assertEquals(a.tagName, "a");
  assertEquals(a.properties.href, "/x");
  assertEquals(a.properties.title, "tooltip");
  assertEquals(a.children[0].value, "click");

  assertEquals(span.tagName, "span");
  assertEquals(span.properties.style, "color:red");
  assertEquals(span.children[0].value, "hot");
});

Deno.test("note: becomes <blockquote class='note'>…", () => {
  const p: ParagraphNode = { type: "paragraph", children: [{ type: "text", value: "NB" }] };
  const note: NoteNode = { type: "note", children: [p] };

  const hast = renderBlocks([note]);
  const node = hast.children[0] as any;
  assertEquals(node.tagName, "blockquote");
  assertEquals(node.properties.class, "note");
  assertEquals(node.children[0].tagName, "p");
  assertEquals(node.children[0].children[0].value, "NB");
});

Deno.test("list (unordered): <ul><li>…", () => {
  const li: ListItemNode = {
    type: "listItem",
    children: [{ type: "paragraph", children: [{ type: "text", value: "a" }] }],
  };
  const list: ListNode = { type: "list", data: { ordered: false }, children: [li] };

  const hast = renderBlocks([list]);
  const ul = hast.children[0] as any;
  assertEquals(ul.tagName, "ul");
  const liEl = ul.children[0];
  assertEquals(liEl.tagName, "li");
  assertEquals(liEl.children[0].tagName, "p");
  assertEquals(liEl.children[0].children[0].value, "a");
});

Deno.test("list (ordered): <ol><li>…", () => {
  const li: ListItemNode = {
    type: "listItem",
    children: [{ type: "paragraph", children: [{ type: "text", value: "1st" }] }],
  };
  const list: ListNode = { type: "list", data: { ordered: true }, children: [li] };

  const hast = renderBlocks([list]);
  const ol = hast.children[0] as any;
  assertEquals(ol.tagName, "ol");
  assertEquals(ol.children[0].tagName, "li");
  assertEquals(ol.children[0].children[0].children[0].value, "1st");
});

Deno.test("table: <table><tr><td>…", () => {
  const td1: TableCellNode = {
    type: "tableCell",
    children: [{ type: "paragraph", children: [{ type: "text", value: "A" }] }],
  };
  const td2: TableCellNode = {
    type: "tableCell",
    children: [{ type: "paragraph", children: [{ type: "text", value: "B" }] }],
  };
  const tr: TableRowNode = { type: "tableRow", children: [td1, td2] };
  const table: TableNode = { type: "table", children: [tr] };

  const hast = renderBlocks([table]);
  const tbl = hast.children[0] as any;
  assertEquals(tbl.tagName, "table");
  const row = tbl.children[0];
  assertEquals(row.tagName, "tr");
  const [c1, c2] = row.children;
  assertEquals(c1.tagName, "td");
  assertEquals(c1.children[0].tagName, "p");
  assertEquals(c1.children[0].children[0].value, "A");
  assertEquals(c2.children[0].children[0].value, "B");
});

Deno.test("codeBlock: preserved as <code-block> with properties + text content", () => {
  const cb: CodeBlockNode = {
    type: "codeBlock",
    data: {
      lang: "xml",
      includeLines: "1-2",
      collapsible: true,
      collapsedTitle: "Show",
      content: "<img src='a.png'/>",
    },
    children: [],
  };

  const hast = renderBlocks([cb]);
  const el = hast.children[0] as any;
  assertEquals(el.tagName, "code-block");
  assertEquals(el.properties.lang, "xml");
  assertEquals(el.properties["include-lines"], "1-2");
  assertEquals(el.properties.collapsible, "true");
  assertEquals(el.properties["collapsed-title"], "Show");
  assertEquals(el.children[0].value, "<img src='a.png'/>");
});

Deno.test("includeMarker: ignored (no output node)", () => {
  const hast = renderBlocks([
    { type: "includeMarker", data: { from: "/lib.topic", elementId: "s1" }, children: [] } as any,
  ]);
  // nothing generated
  assertEquals(hast.children.length, 0);
});

Deno.test("snippetDef: ignored in output (used only via include)", () => {
  const hast = renderBlocks([
    { type: "snippetDef", data: { id: "s1" }, children: [{ type: "paragraph", children: [{ type: "text", value: "S" }] }] } as any,
  ]);
  assertEquals(hast.children.length, 0);
});

Deno.test("spotlight: becomes <div class='spotlight'>", () => {
  const sp: SpotlightNode = { type: "spotlight", children: [] };
  const hast = renderBlocks([sp]);
  const el = hast.children[0] as any;
  assertEquals(el.tagName, "div");
  assertEquals(el.properties.class, "spotlight");
});

Deno.test("loose text block: emitted as text node", () => {
  const t: TextNode = { type: "text", value: "loose" };
  const hast = renderBlocks([t]);
  const n = hast.children[0] as any;
  assertEquals(n.type, "text");
  assertEquals(n.value, "loose");
});

Deno.test("paragraph link summary -> title attribute", () => {
  const link: LinkNode = {
    type: "link",
    data: { href: "https://ex", summary: "hint" },
    children: [{ type: "text", value: "ex" }],
  };
  const p: ParagraphNode = { type: "paragraph", children: [link] };

  const hast = renderBlocks([p]);
  const a = (hast.children[0] as any).children[0];
  assertEquals(a.tagName, "a");
  assertEquals(a.properties.href, "https://ex");
  assertEquals(a.properties.title, "hint");
  assertEquals(a.children[0].value, "ex");
});

/** bonus: mixed block order sanity */
Deno.test("mixed blocks: basic ordering preserved", () => {
  const ch: ChapterNode = { type: "chapter", data: { id: "c", title: "Cap" }, children: [] };
  const p: ParagraphNode = { type: "paragraph", children: [{ type: "text", value: "P" }] };
  const cb: CodeBlockNode = { type: "codeBlock", data: { lang: "bash", content: "echo hi" }, children: [] };

  const hast = renderBlocks([ch, p, cb]);
  const tags = (hast.children as any[]).map(n => n.tagName ?? n.type);
  assertEquals(tags.slice(0, 3), ["h2", "p", "code-block"]);
  assertStringIncludes((hast.children[1] as any).children[0].value, "P");
});
