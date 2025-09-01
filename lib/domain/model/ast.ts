// UNIST base
export interface Position { start?: { line: number; column: number }; end?: { line: number; column: number } }
export interface UnistNode { type: string; data?: Record<string, unknown>; position?: Position }
export interface UnistParent extends UnistNode { children: UnistNode[] }

// Public AST (resolved)
export interface DocsetRoot extends UnistParent {
  type: "docset";
  data: { topicsDir: string; imagesDir: { dir: string; webPath?: string } };
  children: [InstancesNode, PagesNode];
}

export interface InstancesNode extends UnistParent { type: "instances"; children: InstanceNode[] }
export interface InstanceNode extends UnistParent {
  type: "instance";
  data: { id: string; name: string; startPage: string; isLibrary?: boolean; webPath?: string };
  children: TocNode[];
}
export interface TocNode extends UnistParent { type: "toc"; data: { title?: string; topic?: string; file?: string }; children: TocNode[] }

export interface PagesNode extends UnistParent { type: "pages"; children: (TopicPageNode | MarkdownPageNode)[] }
export interface TopicPageNode extends UnistParent {
  type: "topicPage";
  data: {
    file: string; id: string; title: string; isLibrary?: boolean;
    summaries?: Partial<Record<"link"|"card"|"web", string>>;
  };
  children: TopicBlockNode[];
}
export interface MarkdownPageNode extends UnistParent { type: "markdownPage"; data: { file: string; title?: string }; children: UnistNode[] }

// Topic node kinds
export type TopicBlockNode =
  | ChapterNode | ParagraphNode | NoteNode | ListNode | TableNode
  | CodeBlockNode | IncludeMarkerNode | FormatNode | LinkNode | SpotlightNode | SnippetDefNode | TextNode;

export interface ChapterNode extends UnistParent { type: "chapter"; data: { id: string; title: string }; children: TopicBlockNode[] }
export interface ParagraphNode extends UnistParent { type: "paragraph"; children: (TextNode | LinkNode | FormatNode)[] }
export interface TextNode extends UnistNode { type: "text"; value: string }

export interface NoteNode extends UnistParent { type: "note"; children: TopicBlockNode[] }
export interface SpotlightNode extends UnistParent { type: "spotlight"; children: UnistNode[] }
export interface ListNode extends UnistParent { type: "list"; data: { ordered?: boolean }; children: ListItemNode[] }
export interface ListItemNode extends UnistParent { type: "listItem"; children: TopicBlockNode[] }

export interface TableNode extends UnistParent { type: "table"; children: TableRowNode[] }
export interface TableRowNode extends UnistParent { type: "tableRow"; children: TableCellNode[] }
export interface TableCellNode extends UnistParent { type: "tableCell"; children: TopicBlockNode[] }

export interface CodeBlockNode extends UnistParent {
  type: "codeBlock";
  data: { lang?: string; src?: string; includeLines?: string; collapsible?: boolean; collapsedTitle?: string; content?: string };
  children: [];
}
export interface IncludeMarkerNode extends UnistParent { type: "includeMarker"; data: { from: string; elementId: string }; children: [] }
export interface FormatNode extends UnistParent { type: "format"; data: { style: string }; children: (TextNode | LinkNode)[] }
export interface LinkNode extends UnistParent { type: "link"; data: { href: string; summary?: string }; children: TextNode[] }
export interface SnippetDefNode extends UnistParent { type: "snippetDef"; data: { id: string }; children: TopicBlockNode[] }