// src/domain/resolve/resolve_code_blocks.ts (pure)
import { TopicPageNode } from "../model/ast.ts";

export type FetchCode = (src: string) => Promise<string>;

export async function resolveCodeBlocks(page: TopicPageNode, fetchCode: FetchCode) {
  async function walk(node: any) {
    if (!node) return;
    if (node.type === "codeBlock" && node.data?.src &&  isCodeBlockFile(node.data.src)) { // todo
      const content = await fetchCode(node.data.src);
      node.data.content = slice(content, node.data.includeLines);
    }
    if (node.children) for (const c of node.children) await walk(c);
  }
  await walk(page);
}

function isCodeBlockFile(file: string): boolean {
  const lower = file.toLowerCase();
  return (
    lower.endsWith(".json") ||
    lower.endsWith(".php") ||
    lower.endsWith(".txt")
  );
}

function slice(content: string, spec?: string) {
  if (!spec) return content;
  const lines = content.split(/\r?\n/);
  if (spec.includes(",")) return spec.split(",").map(s => lines[+s-1] ?? "").join("\n");
  if (spec.includes("-")) { const [a,b] = spec.split("-").map(n => +n || undefined); return lines.slice((a??1)-1, b??lines.length).join("\n"); }
  const n = +spec; return Number.isFinite(n) ? (lines[n-1] ?? "") : content;
}
