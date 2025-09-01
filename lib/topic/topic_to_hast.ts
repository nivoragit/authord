// src/topic/topic_to_hast.ts
import type {
  TopicPageNode, TopicBlockNode, ChapterNode, ParagraphNode, TextNode,
  NoteNode, ListNode, ListItemNode, TableNode, TableRowNode, TableCellNode,
  CodeBlockNode, IncludeMarkerNode, FormatNode, LinkNode, SnippetDefNode, SpotlightNode,
} from "../domain/model/ast.ts";

type HNode = { type: "element" | "text" | "comment"; tagName?: string; properties?: Record<string, unknown>; children?: HNode[]; value?: string };
type HRoot = { type: "root"; children: HNode[] };

export function topicToHast(page: TopicPageNode): HRoot {
  const children: HNode[] = [];
  for (const b of page.children) children.push(...convertBlock(b, 0));
  return { type: "root", children };
}

function convertBlock(b: TopicBlockNode, depth: number): HNode[] {
  switch (b.type) {
    case "chapter": return convertChapter(b as ChapterNode, depth);
    case "paragraph": return [convertParagraph(b as ParagraphNode)];
    case "note": return [convertNote(b as NoteNode, depth)];
    case "list": return [convertList(b as ListNode, depth)];
    case "table": return [convertTable(b as TableNode, depth)];
    case "codeBlock": return [convertCode(b as CodeBlockNode)];
    case "includeMarker": return [];
    case "format": return [wrapSpan(b as FormatNode)];
    case "link": return [convertLink(b as LinkNode)];
    case "snippetDef": return [];
    case "spotlight": return [convertSpotlight(b as SpotlightNode)];
    case "text": return [{ type: "text", value: (b as TextNode).value }];
    default: return [];
  }
}

function convertChapter(ch: ChapterNode, depth: number): HNode[] {
  const nodes: HNode[] = [];
  const level = Math.min(6, 2 + depth);
  nodes.push(elem(`h${level}`, { id: ch.data.id }, [{ type: "text", value: ch.data.title }]));
  for (const c of ch.children) nodes.push(...convertBlock(c, depth + (c.type === "chapter" ? 1 : 0)));
  return nodes;
}

function convertParagraph(p: ParagraphNode): HNode {
  const kids: HNode[] = [];
  for (const c of p.children) {
    if ((c as any).type === "text") kids.push({ type: "text", value: (c as TextNode).value });
    else if ((c as any).type === "link") kids.push(convertLink(c as any));
    else if ((c as any).type === "format") kids.push(wrapSpan(c as any));
  }
  return elem("p", {}, kids);
}

function convertNote(n: NoteNode, depth: number): HNode {
  const kids: HNode[] = [];
  for (const c of n.children) kids.push(...convertBlock(c, depth));
  return elem("blockquote", { class: "note" }, kids);
}

function convertList(l: ListNode, _depth: number): HNode {
  const tag = l.data?.ordered ? "ol" : "ul";
  const items: HNode[] = (l.children ?? []).map((li: ListItemNode) => {
    const liKids: HNode[] = [];
    for (const c of li.children) liKids.push(...convertBlock(c, _depth));
    return elem("li", {}, liKids.length ? liKids : [{ type: "text", value: "" }]);
  });
  return elem(tag, {}, items);
}

function convertTable(t: TableNode, depth: number): HNode {
  const rows = (t.children ?? []).map((tr: TableRowNode) => {
    const cells = (tr.children ?? []).map((td: TableCellNode) => {
      const kids: HNode[] = [];
      for (const c of td.children) kids.push(...convertBlock(c, depth));
      return elem("td", {}, kids.length ? kids : [{ type: "text", value: "" }]);
    });
    return elem("tr", {}, cells);
  });
  return elem("table", {}, rows);
}

function convertCode(cb: CodeBlockNode): HNode {
  const props: Record<string, unknown> = {};
  if (cb.data?.lang) props.lang = cb.data.lang;
  if (cb.data?.collapsedTitle) props["collapsed-title"] = cb.data.collapsedTitle;
  if (cb.data?.collapsible) props.collapsible = "true";
  if (cb.data?.includeLines) props["include-lines"] = cb.data.includeLines;

  const content = (cb.data?.content ?? "") as string;
  return elem("code-block", props, content ? [{ type: "text", value: content }] : []);
}

function wrapSpan(f: FormatNode): HNode {
  const style = f.data?.style ? String(f.data.style) : "";
  const kids: HNode[] = [];
  for (const c of f.children) {
    if ((c as any).type === "text") kids.push({ type: "text", value: (c as TextNode).value });
    else if ((c as any).type === "link") kids.push(convertLink(c as any));
  }
  return elem("span", style ? { style } : {}, kids);
}

function convertLink(a: LinkNode): HNode {
  const text = ((a.children ?? [])[0] as TextNode | undefined)?.value ?? "";
  return elem("a", { href: a.data?.href ?? "", title: a.data?.summary }, [{ type: "text", value: text }]);
}

function convertSpotlight(_s: SpotlightNode): HNode {
  return elem("div", { class: "spotlight" }, []);
}

function elem(tag: string, props: Record<string, unknown>, children: HNode[]): HNode {
  return { type: "element", tagName: tag, properties: props, children };
}
