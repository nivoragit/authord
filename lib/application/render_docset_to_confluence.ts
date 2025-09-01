// src/application/render_docset_to_confluence.ts
import type {
  DocsetRoot,
  MarkdownPageNode,
  TopicPageNode,
  InstanceNode,
  TocNode,
  PagesNode,
  InstancesNode,
} from "../domain/model/ast.ts";
import type { Resource } from "./build_docset_ast.ts";

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeStringify from "npm:rehype-stringify@10";

import rehypeConfluenceStorage from "../plugins/rehype-confluence-storage.ts";
import remarkConfluenceMedia from "../plugins/remark-confluence-media.ts";
import { topicToHast } from "../topic/topic_to_hast.ts";

export type RenderResult = { file: string; xml: string; kind: "markdown" | "topic" };

export type RenderOptions = {
  confluence?: {
    insertToc?: boolean;
    tocMacroId?: string;
    tocMaxLevel?: number;
    tocPosition?: "top" | "after-first-h1";
  };
  media?: Parameters<typeof remarkConfluenceMedia>[0];
};

/** Most efficient: single pass over ordered pages (TOC pre-order + unattached). */
export async function renderDocsetToConfluence(
  docset: DocsetRoot,
  resource: Resource,
  options: RenderOptions = {},
): Promise<RenderResult[]> {
  const ordered = orderedPages(docset);
  const out: RenderResult[] = [];

  for (const node of ordered) {
    if (node.type === "markdownPage") {
      const xml = await renderMarkdownPage(node as MarkdownPageNode, resource, options);
      out.push({ file: (node as MarkdownPageNode).data.file, xml, kind: "markdown" });
    } else if (node.type === "topicPage") {
      const xml = await renderTopicPage(node as TopicPageNode, options);
      out.push({ file: (node as TopicPageNode).data.file, xml, kind: "topic" });
    }
  }
  return out;
}

/* ---------- ordering (TOC pre-order + unattached) ---------- */
function orderedPages(docset: DocsetRoot): (MarkdownPageNode | TopicPageNode)[] {
  const pagesNode = docset.children.find((c: any) => c?.type === "pages") as PagesNode | undefined;
  if (!pagesNode) return [];

  const byFile = new Map<string, MarkdownPageNode | TopicPageNode>();
  for (const ch of (pagesNode.children ?? []) as Array<MarkdownPageNode | TopicPageNode>) {
    const abs = (ch as any).data?.file as string | undefined;
    if (abs) byFile.set(abs, ch);
  }

  const instances = docset.children.find((c: any) => c?.type === "instances") as InstancesNode | undefined;
  const ordered: (MarkdownPageNode | TopicPageNode)[] = [];

  if (instances) {
    const visit = (n: any) => {
      if (n?.type === "toc") {
        const file = (n.data?.topic ?? n.data?.file) as string | undefined;
        if (file && byFile.has(file)) {
          ordered.push(byFile.get(file)!);
          byFile.delete(file);
        }
        for (const c of n.children ?? []) visit(c);
      } else if (Array.isArray(n?.children)) {
        for (const c of n.children) visit(c);
      }
    };
    for (const inst of (instances.children ?? []) as InstanceNode[]) visit(inst);
  }

  // append any page not referenced in TOC (stable by path)
  for (const [_path, node] of Array.from(byFile.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    ordered.push(node);
  }
  return ordered;
}

/* ---------- page renderers ---------- */

async function renderMarkdownPage(
  page: MarkdownPageNode,
  resource: Resource,
  options: RenderOptions,
): Promise<string> {
  const md = await resource.readText(page.data.file);

  const mdPipeline = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkDirective)
    .use(remarkConfluenceMedia, options.media ?? {})
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeConfluenceStorage, options.confluence ?? {})
    .use(rehypeStringify, {
      allowDangerousHtml: true,
      closeSelfClosing: true,
      tightSelfClosing: true,
    });

  const file = await mdPipeline.process(md);
  return String(file.value);
}

async function renderTopicPage(page: TopicPageNode, options: RenderOptions): Promise<string> {
  const hast = topicToHast(page);

  const pipeline = unified()
    .use(rehypeConfluenceStorage, options.confluence ?? {})
    .use(rehypeStringify, {
      allowDangerousHtml: true,
      closeSelfClosing: true,
      tightSelfClosing: true,
    });

  // HAST in → run → stringify (no parser).
  const transformed = await pipeline.run(hast as any);
  return String(pipeline.stringify(transformed as any));
}
