import { MarkdownPageNode } from "../model/ast.ts";

export function parseMarkdown(text: string, file: string): MarkdownPageNode {
  const title = /^#\s+(.+)/m.exec(text)?.[1];
  return { type: "markdownPage", data: { file, title }, children: [] };
}
