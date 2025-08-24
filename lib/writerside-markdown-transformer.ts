/**********************************************************************
 * transformers/writerside-markdown-transformer.ts
 * md → remarkConfluenceMedia → remarkRehype(+raw) →
 * rehypeConfluenceStorage → XHTML string
 *********************************************************************/

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkDirective from 'remark-directive';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeStringify from 'rehype-stringify';

import { remarkConfluenceMedia } from './plugins/remark-confluence-media.ts';
import { rehypeConfluenceStorage } from './plugins/rehype-confluence-storage.ts';

function buildStorageProcessor() {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkDirective)
    .use(remarkConfluenceMedia)                 // Mermaid + MD image sizing
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)                             // parse raw HTML into HAST
    .use(rehypeConfluenceStorage)               // Convert img/input/etc.
    .use(rehypeStringify, {
      allowDangerousHtml: true,
      closeSelfClosing: true,
      tightSelfClosing: true,
      preferUnquoted: false,
      quote: '"',
    });
}

export class WritersideMarkdownTransformerDC {
  async toStorage(md: string) {
    const vfile = await buildStorageProcessor().process(md);
    return { value: String(vfile), representation: 'storage' as const };
  }
}
