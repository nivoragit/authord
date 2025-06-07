/**
 * @authord/renderer-html
 *
 * Build a single-page HTML file from one-or-many Markdown sources
 * using the WritersideMarkdownTransformer-powered remark renderer.
 *
 *   renderHtml(markdownFilePaths[], { inlineAssets?: true, projectTitle?: '...' })
 *
 * Dependencies (install in this package):
 *   npm i fs-extra mime-types remark remark-parse remark-stringify \
 *         remark-directive unified @atlaskit/editor-markdown-transformer \
 *         @atlaskit/adf-schema unist-util-visit github-slugger
 */


import fs from 'fs-extra';
import path from 'path';
import mime from 'mime-types';
import { renderContent } from './remarkRenderer';

// export { render_all } from './render-all-markdown';

export interface RenderOptions {
  /** embed images/fonts as data: URIs */
  inlineAssets?: boolean;
  /** <title> … </title> text */
  projectTitle?: string;


}

export async function renderHtml(
  filePaths: string[],
  opts: RenderOptions = {},
): Promise<{ html: string; assets: string[] }> {
  if (!filePaths.length) {
    throw new Error('renderHtml: no Markdown files supplied');
  }

  /* 1️⃣  read every file, collect image refs while we go */
  const mdParts: string[] = [];
  const assetMap: Map<string, string> = new Map(); // rel → absolute

  const IMG_RE = /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]+")?\)/g;

  for (const fp of filePaths) {
    const raw = await fs.readFile(fp, 'utf8');
    mdParts.push(raw);

    if (!opts.inlineAssets) {
      const dir = path.dirname(fp);
      for (const m of raw.matchAll(IMG_RE)) {
        const rel = m[1];
        if (/^(https?:)?\/\//i.test(rel)) continue; // external – ignore
        assetMap.set(rel, path.resolve(dir, rel));
      }
    }
  }

  /* 2️⃣  join files with a thematic break so headings don’t collide */
  const combinedMd = mdParts.join('\n\n---\n\n');

  /* 3️⃣  remark → Writerside → HTML (with scroll-sync wrapper) */
  let html = await renderContent(combinedMd);

  /* 4️⃣  inject <title> if caller supplied one */
  if (opts.projectTitle) {
    html = html.replace(
      '<head>',
      `<head><title>${escapeHtml(opts.projectTitle)}</title>`,
    );
  }

  /* 5️⃣  inline or list assets */
  const assets: string[] = [];

  if (opts.inlineAssets) {
    // swap every <img src="rel"> for a base64 URI
    for (const [rel, abs] of assetMap) {
      if (!fs.existsSync(abs)) continue;
      const data = await fs.readFile(abs);
      const mimeType = mime.lookup(abs) || 'application/octet-stream';
      const uri = `data:${mimeType};base64,${data.toString('base64')}`;
      const esc = rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // escape for RegExp
      html = html.replace(new RegExp(`src=["']${esc}["']`, 'g'), `src="${uri}"`);
    }
  } else {
    assets.push(...assetMap.keys());
  }

  return { html, assets };
}

/* util -------------------------------------------------------------------- */

function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
  );
}
