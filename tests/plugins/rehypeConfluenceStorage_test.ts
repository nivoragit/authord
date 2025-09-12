// rehypeConfluenceStorage_test.ts
// deno-lint-ignore-file no-explicit-any

import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
  assertMatch,
} from "std/assert";
import rehypeConfluenceStorage from "../../lib/plugins/rehype_confluence_storage.ts";




/* -------------------- minimal HAST helpers -------------------- */

type HNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, any>;
  children?: HNode[];
  value?: string;
  selfClosing?: boolean;
};
type HRoot = HNode;

const root = (children: HNode[] = []): HRoot => ({ type: "root", children });
const el = (tagName: string, props: Record<string, any> = {}, children: HNode[] = []): HNode => ({
  type: "element",
  tagName,
  properties: props,
  children,
});
const txt = (value: string): HNode => ({ type: "text", value });

function run(input: HRoot, opts?: Parameters<typeof rehypeConfluenceStorage>[0]) {
  const plugin = rehypeConfluenceStorage(opts);
  const tree = structuredClone(input) as HRoot;
  plugin(tree);
  return tree;
}

function findAll(node: any, predicate: (n: any) => boolean, acc: any[] = []): any[] {
  if (node && node.type === "element" && predicate(node)) acc.push(node);
  const kids = node && Array.isArray(node.children) ? node.children : [];
  for (const c of kids) findAll(c, predicate, acc);
  return acc;
}
function findOne(node: any, predicate: (n: any) => boolean): any | undefined {
  return findAll(node, predicate)[0];
}
function textContent(node: any): string {
  const out: string[] = [];
  const walk = (n: any) => {
    if (!n) return;
    if (n.type === "text" && typeof n.value === "string") out.push(n.value);
    if (Array.isArray(n.children)) n.children.forEach(walk);
  };
  walk(node);
  return out.join("");
}

/* -------------------- tests -------------------- */

Deno.test("wraps top-level ac:image in <p> and converts <img> → <ac:image>", () => {
  const input = root([el("img", { src: "cat.png", width: "300", alt: "A cat" })]);
  const tree = run(input);

  const nsDiv = findOne(tree, (n) => n.tagName === "div" && n.properties?.["xmlns:ac"]);
  assertExists(nsDiv);

  const acImages = findAll(nsDiv, (n) => n.tagName === "ac:image");
  assertEquals(acImages.length, 1);

  const pWrappers = findAll(nsDiv, (n) => n.tagName === "p");
  assertEquals(pWrappers.length, 1);

  const acProps = acImages[0].properties || {};
  assertEquals(acProps["ac:width"], "300");
  assertEquals(acProps["ac:thumbnail"], "true");

  const ri = findOne(acImages[0], (n) => n.tagName === "ri:attachment");
  assertEquals(ri?.properties?.["ri:filename"], "cat.png");
});

Deno.test("consumes trailing {width=120} attr block after <img>", () => {
  const input = root([
    el("img", { src: "dog.png" }),
    txt(" "),
    txt("{width=120}"),
  ]);
  const tree = run(input);
  const acImage = findOne(tree, (n) => n.tagName === "ac:image");
  assertEquals(acImage?.properties?.["ac:width"], "120");
  assertEquals(acImage?.properties?.["ac:thumbnail"], "true");
});

Deno.test("<a href + anchor> → href#anchor and unwrap <a><ac:image/></a>", () => {
  const input = root([
    el("a", { href: "t.topic", anchor: "sec" }, [txt("Link")]),
    el("a", {}, [el("img", { src: "x.png" })]),
  ]);
  const tree = run(input);

  const link = findOne(tree, (n) => n.tagName === "a" && n.properties?.href === "t.topic#sec");
  assertExists(link);

  // the second <a> should be unwrapped into plain ac:image
  const strayA = findOne(tree, (n) => n.tagName === "a" && findOne(n, (m) => m.tagName === "ac:image"));
  assertEquals(strayA, undefined);

  const ac = findOne(tree, (n) => n.tagName === "ac:image");
  assertExists(ac);
});

Deno.test("<video> YouTube/Vimeo → widget; local → multimedia", () => {
  const you = run(root([el("video", { src: "https://youtu.be/abc123", width: "640", height: "360" })]));
  const macroYou = findOne(you, (n) => n.tagName === "ac:structured-macro" && n.properties?.["ac:name"] === "widget");
  assertExists(macroYou);
  const youParams = findAll(macroYou, (n) => n.tagName === "ac:parameter");
  const mapY: Record<string, string> = {};
  youParams.forEach((p: any) => (mapY[p.properties["ac:name"]] = textContent(p)));
  assertMatch(mapY.url, /youtu/);
  assertEquals(mapY.width, "640");
  assertEquals(mapY.height, "360");

  const local = run(root([el("video", { src: "demo.mp4", width: "480" })]));
  const macroLocal = findOne(local, (n) => n.tagName === "ac:structured-macro" && n.properties?.["ac:name"] === "multimedia");
  assertExists(macroLocal);
  const att = findOne(macroLocal, (n) => n.tagName === "ri:attachment");
  assertEquals(att?.properties?.["ri:filename"], "demo.mp4");
});

Deno.test("<code-block lang='xml'> inlines CDATA and @@ATTACH tokens for <img>", () => {
  const xmlLiteral = `<root><img src="icon.png" width="200"/></root>`;
  const input = root([
    el("code-block", { lang: "xml" }, [
      el("span", {}, [txt(xmlLiteral)]),
    ]),
  ]);
  const tree = run(input);
  const codeMacro = findOne(tree, (n) => n.tagName === "ac:structured-macro" && n.properties?.["ac:name"] === "code");
  assertExists(codeMacro);
  const plain = findOne(codeMacro, (n) => n.tagName === "ac:plain-text-body");
  assertExists(plain);
  const t = textContent(plain);
  assertStringIncludes(t, "<!--[CDATA[");
  assertStringIncludes(t, "@@ATTACH|file=icon.png|width=200@@");
});

Deno.test("<compare> → 2-col table by default; vertical when type=top-bottom", () => {
  const twoUp = run(root([
    el("compare", {}, [
      el("code-block", { lang: "plain text" }, [txt("A")]),
      el("code-block", { lang: "plain text" }, [txt("B")]),
    ]),
  ]));
  const table = findOne(twoUp, (n) => n.tagName === "table" && (n.properties?.className || []).includes("ws-compare"));
  assertExists(table);

  const vertical = run(root([
    el("compare", { type: "top-bottom", "title-before": "Old", "title-after": "New" }, [
      el("code-block", { lang: "plain text" }, [txt("X")]),
      el("code-block", { lang: "plain text" }, [txt("Y")]),
    ]),
  ]));
  const container = findOne(vertical, (n) => n.tagName === "div" && (n.properties?.className || []).includes("ws-vertical"));
  assertExists(container);
});

Deno.test("<note>/<tip>/<warning> → Confluence panel macros", () => {
  const tree = run(root([
    el("note", {}, [txt("Hi")]),
    el("tip", {}, [txt("Pro")]),
    el("warning", {}, [txt("Careful")]),
  ]));
  const info = findOne(tree, (n) => n.tagName === "ac:structured-macro" && n.properties?.["ac:name"] === "info");
  const tip = findOne(tree, (n) => n.tagName === "ac:structured-macro" && n.properties?.["ac:name"] === "tip");
  const warn = findOne(tree, (n) => n.tagName === "ac:structured-macro" && n.properties?.["ac:name"] === "warning");
  assert(info && tip && warn);
});

Deno.test("<list> transforms: decimal/start, none style, columns", () => {
  const ordered = run(root([
    el("list", { type: "decimal", start: "5" }, [el("li", {}, [el("p", {}, [txt("Item")])])]),
  ]));
  const ol = findOne(ordered, (n) => n.tagName === "ol");
  assertEquals(ol?.properties?.start, "5");

  const none = run(root([
    el("list", { type: "none" }, [el("li", {}, [el("p", {}, [txt("N")])])]),
  ]));
  const ul = findOne(none, (n) => n.tagName === "ul");
  assertStringIncludes(String(ul?.properties?.style || ""), "list-style-type:none");

  const cols = run(root([
    el("list", { columns: "3" }, [
      el("li", {}, [el("p", {}, [txt("a")])]),
      el("li", {}, [el("p", {}, [txt("b")])]),
    ]),
  ]));
  const ulCols = findOne(cols, (n) => n.tagName === "ul");
  assertStringIncludes(String(ulCols?.properties?.style || ""), "column-count:3");
});

Deno.test("<table> header-row default: first row td → th", () => {
  const input = root([
    el("table", {}, [
      el("tr", {}, [el("td", {}, [txt("Col A")]), el("td", {}, [txt("Col B")])]),
      el("tr", {}, [el("td", {}, [txt("a1")]), el("td", {}, [txt("b1")])]),
    ]),
  ]);
  const tree = run(input);
  const firstRow = findAll(tree, (n) => n.tagName === "tr")[0]!;
  const cells = (firstRow.children || []).filter((c: any) => c.type === "element");
  assertEquals(cells[0].tagName, "th");
  assertEquals(cells[1].tagName, "th");
});

Deno.test("inline UI/format tags mapping", () => {
  const tree = run(root([
    el("emphasis", {}, [txt("i")]),
    el("format", { style: "bold", color: "Red" }, [txt("b")]),
    el("control", {}, [txt("OK")]),
    el("path", {}, [txt("~/x")]),
    el("ui-path", {}, [txt("File | Open")]),
  ]));
  assertExists(findOne(tree, (n) => n.tagName === "em"));

  const fmt = findOne(tree, (n) => n.tagName === "span" && (n.properties?.style || "").includes("font-weight:bold"));
  assertExists(fmt);

  const control = findOne(tree, (n) => n.tagName === "span" && (n.properties?.className || []).includes("ws-control"));
  const pathNode = findOne(tree, (n) => n.tagName === "code" && (n.properties?.className || []).includes("ws-path"));
  const ui = findOne(tree, (n) => n.tagName === "span" && (n.properties?.className || []).includes("ws-ui-path"));
  assert(control && pathNode && ui);
});

Deno.test("inserts TOC macro when <show-structure depth='2'/> and removes directive", () => {
  const tree = run(root([
    el("show-structure", { depth: "2" }),
    el("p", {}, [txt("Body")]),
  ]));
  const container = findOne(tree, (n) => n.tagName === "div" && n.properties?.["xmlns:ac"]);
  const children = container?.children || [];

  const maybeToc = children[0];
  assertEquals(maybeToc.tagName, "ac:structured-macro");
  assertEquals(maybeToc.properties?.["ac:name"], "toc");

  const paramMax = findOne(maybeToc, (n) => n.tagName === "ac:parameter" && n.properties?.["ac:name"] === "maxLevel");
  assertEquals(textContent(paramMax!), "2");

  const leftover = findOne(tree, (n) => n.tagName === "show-structure");
  assertEquals(leftover, undefined);
});

Deno.test("<anchor name> → <span id=.../>", () => {
  const tree = run(root([el("anchor", { name: "intro" })]));
  const span = findOne(tree, (n) => n.tagName === "span" && n.properties?.id === "intro");
  assertExists(span);
});

Deno.test("checkbox inputs → [x]/[ ] text", () => {
  const tree = run(root([
    el("input", { type: "checkbox", checked: true }),
    txt(" "),
    el("input", { type: "checkbox" }),
  ]));
  const txts = findAll(tree, (n) => n.type === "text");
  const blob = txts.map((t: any) => t.value).join(" ");
  assertStringIncludes(blob, "[x]");
  assertStringIncludes(blob, "[ ]");
});

Deno.test("unknown/missing semantic tags remain unchanged (<procedure>, <deflist>, <api-doc>)", () => {
  const tree = run(root([
    el("procedure", { title: "Do things" }, [el("step", {}, [txt("One")]), el("step", {}, [txt("Two")])]),
    el("deflist", {}, [el("def", { title: "Term" }, [txt("Definition")])]),
    el("api-doc", { "openapi-path": "openapi.yaml" }),
  ]));
  assertExists(findOne(tree, (n) => n.tagName === "procedure"));
  assertExists(findOne(tree, (n) => n.tagName === "step"));
  assertExists(findOne(tree, (n) => n.tagName === "deflist"));
  assertExists(findOne(tree, (n) => n.tagName === "def"));
  assertExists(findOne(tree, (n) => n.tagName === "api-doc"));
});

Deno.test("<inline-frame> → widget macro", () => {
  const tree = run(root([el("inline-frame", { src: "https://example.com", width: "800", height: "400" })]));
  const macro = findOne(tree, (n) => n.tagName === "ac:structured-macro" && n.properties?.["ac:name"] === "widget");
  assertExists(macro);
  const params = findAll(macro, (n) => n.tagName === "ac:parameter");
  const map: Record<string, string> = {};
  params.forEach((p: any) => (map[p.properties["ac:name"]] = textContent(p)));
  assertEquals(map.url, "https://example.com");
  assertEquals(map.width, "800");
  assertEquals(map.height, "400");
});

Deno.test("<del> → span with line-through", () => {
  const tree = run(root([el("del", {}, [txt("gone")])]));
  const span = findOne(tree, (n) => n.tagName === "span");
  assertStringIncludes(String(span?.properties?.style || ""), "text-decoration:line-through");
});

Deno.test("<img border-effect=...> emits @@ATTACH token (text), not ac:image", () => {
  const tree = run(root([el("img", { src: "a.png", width: "100", "border-effect": "line" })]));
  const acImg = findOne(tree, (n) => n.tagName === "ac:image");
  assertEquals(acImg, undefined);

  const txts = findAll(tree, (n) => n.type === "text");
  const joined = txts.map((t: any) => t.value).join("");
  assertStringIncludes(joined, "@@ATTACH|file=a.png|width=100@@");
});
