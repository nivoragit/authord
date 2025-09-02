import {
  TopicPageNode, TopicBlockNode, ChapterNode, ParagraphNode, TextNode,
  NoteNode, ListNode, ListItemNode, TableNode, TableRowNode, TableCellNode,
  CodeBlockNode, IncludeMarkerNode, SnippetDefNode, LinkNode, FormatNode, SpotlightNode,
} from "../model/ast.ts";
import { parseXml, asArray } from "../../adapters/xml_fxp.ts";

export function parseTopic(xml: string, filePath: string): TopicPageNode {
  const doc = parseXml<any>(xml);
  const t = doc?.topic;
  if (!t) {
    throw new Error("Invalid .topic: missing <topic>");
  }
    

  const id = t.id;
  const title = t.title;
  const isLibrary = t["is-library"] === "true";

  const summaries: any = {};
  if (t["link-summary"]) summaries.link = text(t["link-summary"]);
  if (t["card-summary"]) summaries.card = text(t["card-summary"]);
  if (t["web-summary"]) summaries.web = text(t["web-summary"]);

  const blocks: TopicBlockNode[] = buildBlocksFromTopicRoot(t);
  return { type: "topicPage", data: { file: filePath, id, title, isLibrary, summaries }, children: blocks };
}

function buildBlocksFromTopicRoot(t: any): TopicBlockNode[] {
  const out: TopicBlockNode[] = [];
  out.push(...asArray(t.chapter).map(parseChapter));
  out.push(...asArray(t.p).map(parseParagraph));
  out.push(...asArray(t.note).map(parseNote));
  out.push(...asArray(t.list).map(parseList));
  out.push(...asArray(t.table).map(parseTable));
  out.push(...asArray(t.include).map(parseInclude));
  out.push(...asArray(t["code-block"]).map(parseCode));
  out.push(...asArray(t.snippet).map(parseSnippet));
  out.push(...asArray(t.spotlight).map(parseSpotlight));
  return out;
}

function parseChapter(ch: any): ChapterNode {
  const node: ChapterNode = { type: "chapter", data: { id: ch.id, title: ch.title }, children: [] };
  node.children.push(...asArray(ch.chapter).map(parseChapter));
  node.children.push(...asArray(ch.p).map(parseParagraph));
  node.children.push(...asArray(ch.note).map(parseNote));
  node.children.push(...asArray(ch.list).map(parseList));
  node.children.push(...asArray(ch.table).map(parseTable));
  node.children.push(...asArray(ch.include).map(parseInclude));
  node.children.push(...asArray(ch["code-block"]).map(parseCode));
  node.children.push(...asArray(ch.snippet).map(parseSnippet));
  node.children.push(...asArray(ch.spotlight).map(parseSpotlight));
  return node;
}

function parseParagraph(p: any): ParagraphNode {
  const children: (TextNode | LinkNode | FormatNode)[] = [];
  if (typeof p === "string") children.push({ type: "text", value: p });
  if (p?.["#text"]) children.push({ type: "text", value: p["#text"] });
  for (const a of asArray(p?.a)) children.push(parseLink(a));
  for (const f of asArray(p?.format)) children.push(parseFormat(f));
  return { type: "paragraph", children };
}

function parseNote(n: any): NoteNode {
  const kids: TopicBlockNode[] = [];
  kids.push(...asArray(n.p).map(parseParagraph));
  kids.push(...asArray(n.list).map(parseList));
  kids.push(...asArray(n["code-block"]).map(parseCode));
  return { type: "note", children: kids };
}

function parseList(l: any): ListNode {
  const ordered = l.type === "ol";
  const items: ListItemNode[] = asArray(l.li).map((li: any) => ({
    type: "listItem",
    children: [
      ...asArray(li.p).map(parseParagraph),
      ...asArray(li["code-block"]).map(parseCode),
    ],
  }));
  return { type: "list", data: { ordered }, children: items };
}

function parseTable(t: any): TableNode {
  const rows: TableRowNode[] = asArray(t.tr).map((tr: any) => ({
    type: "tableRow",
    children: asArray(tr.td).map((td: any) => ({
      type: "tableCell",
      children: [
        ...asArray(td.p).map(parseParagraph),
        ...asArray(td["code-block"]).map(parseCode),
        ...asArray(td.list).map(parseList),
      ],
    })),
  }));
  return { type: "table", children: rows };
}

function parseCode(cb: any): CodeBlockNode {
  return {
    type: "codeBlock",
    data: {
      lang: cb.lang,
      src: cb.src,
      includeLines: cb["include-lines"],
      collapsible: cb.collapsible === "true",
      collapsedTitle: cb["collapsed-title"],
    },
    children: [],
  };
}
function parseInclude(inc: any): IncludeMarkerNode {
  return { type: "includeMarker", data: { from: inc.from, elementId: inc["element-id"] }, children: [] };
}
function parseSnippet(sn: any): SnippetDefNode {
  const body: TopicBlockNode[] = [];
  body.push(...asArray(sn.p).map(parseParagraph));
  body.push(...asArray(sn.list).map(parseList));
  body.push(...asArray(sn.table).map(parseTable));
  body.push(...asArray(sn["code-block"]).map(parseCode));
  return { type: "snippetDef", data: { id: sn.id }, children: body };
}
function parseLink(a: any): LinkNode {
  return { type: "link", data: { href: a.href, summary: a.summary }, children: [{ type: "text", value: a?.["#text"] ?? a?.text ?? "" }] };
}
function parseFormat(f: any): FormatNode { return { type: "format", data: { style: f.style }, children: [{ type: "text", value: text(f) }] }; }
function parseSpotlight(_s: any): SpotlightNode { return { type: "spotlight", children: [] }; }

function text(node: any): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (node["#text"]) return String(node["#text"]);
  return String(node);
}
