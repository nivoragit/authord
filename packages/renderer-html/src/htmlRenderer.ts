import fs from 'fs-extra';
import { unified, Processor, Plugin } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype, { Options as RemarkRehypeOptions } from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeStringify, { Options as RehypeStringifyOptions } from 'rehype-stringify';
import { visitParents } from 'unist-util-visit-parents';
import { visit } from 'unist-util-visit';
import path from 'path';
import mime from 'mime-types';
import { RenderOptions } from '.';
import { imageRootPlugin } from './imageRootPlugin';

let markdownStyles: string | null = null;

/** Swallow plugin errors so the CLI never crashes on mismatch */
function safeUse(
  proc: Processor,
  plugin: any,
  opts?: RemarkRehypeOptions | RehypeStringifyOptions | Record<string, unknown>,
) {
  try {
    proc.use(plugin as any, opts as any);
  } catch (err) {
    console.warn('⚠️  skipping plugin', plugin?.name ?? 'unknown', err);
  }
}

/**
 * Strip **all** leading `{…}` blocks from text, attaching each
 * attribute inside to the preceding element – but skip inside code.
 */
export const braceAttributes: Plugin<[]> = () => {
  const RE = /^\s*\{\s*([^}]*)\}/;
  return (tree: any) => {
    visitParents(tree, 'text', (txtNode: any, ancestors: any[]) => {
      // ① skip inside code or code-block
      if (
        ancestors.some(
          (n) =>
            n.type === 'element' &&
            (n.tagName === 'code' || n.tagName === 'code-block')
        )
      ) {
        return;
      }

      const parent = ancestors[ancestors.length - 1];
      const idx = parent.children.indexOf(txtNode);
      if (idx < 1) return;

      let val: string = txtNode.value;
      let m: RegExpMatchArray | null;
      let changed = false;

      // consume all `{…}` blocks at the front
      while ((m = val.match(RE))) {
        const prev = parent.children[idx - 1];
        if (!prev || prev.type !== 'element') break;

        // parse each pair in the braces
        m[1]
          .trim()
          .split(/\s+/)
          .forEach((pair: string) => {
            if (!pair) return;
            if (pair.startsWith('.')) {
              prev.properties.className = [
                ...(prev.properties.className || []),
                pair.slice(1),
              ];
            } else if (pair.startsWith('#')) {
              prev.properties.id = pair.slice(1);
            } else {
              const [k, v = ''] = pair.split('=');
              prev.properties[k] = v.replace(/^['"]|['"]$/g, '');
            }
          });

        val = val.slice(m[0].length);
        changed = true;
      }

      if (changed) {
        if (!val.trim()) {
          parent.children.splice(idx, 1);
        } else {
          txtNode.value = val;
        }
      }
    });
  };
};

export async function htmlRenderer(
  filePaths: string[],
  opts: RenderOptions = {},
): Promise<{ html: string; assets: string[] }> {
  if (!filePaths.length) {
    throw new Error('htmlRenderer: no Markdown files supplied');
  }

  // 1️⃣ Compute absolute folders
  const absFirst = path.isAbsolute(filePaths[0])
    ? filePaths[0]
    : path.resolve(process.cwd(), filePaths[0]);
  const mdDir = path.dirname(absFirst);              // …/authord/example/topics
  const projectRoot = path.dirname(mdDir);           // …/authord/example
  const imagesAbs = path.join(projectRoot, 'images'); // …/authord/example/images

  // 2️⃣ Read MD & build assetMap (abs→abs)
  const mdParts: string[] = [];
  const assetMap = new Map<string, string>();
  const IMG_RE = /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]+")?\)/g;

  for (const fp of filePaths) {
    const raw = await fs.readFile(fp, 'utf8');
    mdParts.push(raw);

    if (!opts.inlineAssets) {
      for (const m of raw.matchAll(IMG_RE)) {
        const name = m[1];
        if (/^(https?:|data:)/i.test(name)) continue;
        const abs = path.join(imagesAbs, name);
        assetMap.set(abs, abs);
      }
    }
  }

  // 3️⃣ Build the processor
  const proc = unified();
  safeUse(proc, remarkParse);
  safeUse(proc, remarkGfm);
  safeUse(proc, remarkRehype, { allowDangerousHtml: true });
  safeUse(proc, rehypeRaw);
  safeUse(proc, braceAttributes);
  safeUse(proc, imageRootPlugin, { imageFolder: imagesAbs });
  safeUse(proc, rehypeStringify, { allowDangerousHtml: true });

  // 4️⃣ Process
  const combined = mdParts.join('\n\n---\n\n');
  const file = await proc.process(combined);

  // 5️⃣ Wrap & inject title
  let html = wrapHtml(String(file));
  if (opts.projectTitle) {
    html = html.replace(
      '<head>',
      `<head><title>${escapeHtml(opts.projectTitle)}</title>`,
    );
  }

  // 6️⃣ Inline or list assets
  const assets: string[] = [];
  if (opts.inlineAssets) {
    for (const [src, abs] of assetMap) {
      if (!fs.existsSync(abs)) continue;
      const data = await fs.readFile(abs);
      const uri =
        `data:${mime.lookup(abs) || 'application/octet-stream'};base64,` +
        data.toString('base64');
      html = html.replace(
        new RegExp(`src=["']${src}["']`, 'g'),
        `src="${uri}"`,
      );
    }
  } else {
    assets.push(...assetMap.keys());
  }

  return { html, assets };
}

function wrapHtml(inner: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body>${inner}</body></html>`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!),
  );
}
