// WritersideMarkdownTransformer
// Unified pipeline:
//  remark-parse + remark-gfm + remark-directive + remark-confluence-media
//  -> remark-rehype({ allowDangerousHtml: true })
//  -> rehype-raw
//  -> rehype-confluence-storage
//  -> rehype-stringify({ allowDangerousHtml: true, closeSelfClosing: true, tightSelfClosing: true })

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeStringify from "rehype-stringify";

import remarkConfluenceMedia from "./plugins/remark-confluence-media.ts";
import rehypeConfluenceStorage from "./plugins/rehype-confluence-storage.ts";

import type { IMarkdownTransformer } from "./ports/ports.ts";
import { asStorageXhtml, type StorageXhtml } from "./utils/types.ts";

export class WritersideMarkdownTransformer implements IMarkdownTransformer {
  async toStorage(markdown: string): Promise<StorageXhtml> {
    let mermaidCount = 0;

    const file = await unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkDirective)
      .use(remarkConfluenceMedia, {
        onMermaid: ({ index }) => {
          // No rendering here; just a deterministic placeholder filename.
          mermaidCount = index;
          return { filename: `mermaid-${index}.png` };
        },
      })
      .use(remarkRehype, { allowDangerousHtml: true })
      .use(rehypeRaw)
      .use(rehypeConfluenceStorage)
      .use(rehypeStringify, {
        allowDangerousHtml: true,
        closeSelfClosing: true,
        tightSelfClosing: true,
      })
      .process(markdown);

    const out = String(file);
    return asStorageXhtml(out);
  }
}
