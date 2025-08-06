/**********************************************************************
 * writerside-markdown-transformer-dc.ts
 * Confluence Data Center / Server  –  strict-XHTML + auto-copied diagrams
 * • Detects Mermaid / PlantUML blocks → PNG (cached, deterministic hash)
 * • Copies/links every generated PNG into IMAGE_DIR so imageSize() works
 * • Self-closes all void tags (<hr/>, <br/>, …) for XHTML 1.0 validity
 *********************************************************************/

import { MarkdownTransformer } from '@atlaskit/editor-markdown-transformer';
import { defaultSchema }       from '@atlaskit/adf-schema/schema-default';
import type { Schema }         from 'prosemirror-model';

import { unified }             from 'unified';
import remarkParse             from 'remark-parse';
import remarkDirective         from 'remark-directive';
import remarkGfm               from 'remark-gfm';
import remarkStringify         from 'remark-stringify';
import remarkRehype            from 'remark-rehype';
import rehypeStringify         from 'rehype-stringify';
import rehypeRaw               from 'rehype-raw';
import { visit }               from 'unist-util-visit';
import type { Parent }         from 'unist';
import type { Image, Code }    from 'mdast';

import { execFileSync }        from 'child_process';
import * as fs                 from 'fs';
import * as path               from 'path';
import { tmpdir, homedir }     from 'os';
import { imageSize }           from 'image-size';

/* ═════════════════  CONSTANTS & HELPERS  ═════════════════ */

const WORK_DIR   = path.join(tmpdir(), 'writerside-diagrams');
const PNG_MAGIC  = Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]);
fs.mkdirSync(WORK_DIR, { recursive: true });

const PLANTUML_JAR = (() => {
  const envJar  = process.env.PLANTUML_JAR?.replace(/^~(?=$|[\\/])/, homedir());
  const vendor  = path.resolve(__dirname, '../vendor/plantuml.jar');
  const homeJar = path.resolve(homedir(), 'bin/plantuml.jar');
  const pick    = [envJar, vendor, homeJar].find(p => p && fs.existsSync(p));
  if (!pick) throw new Error('plantuml.jar not found – set $PLANTUML_JAR or place jar in vendor/');
  return pick;
})();

export const IMAGE_DIR = process.env.AUTHORD_IMAGE_DIR ||
                         path.resolve(process.cwd(), 'writerside', 'images');

const VOID_RE = /<(hr|br|img|input|meta|link)(\s[^/>]*)?>/gi;          // XHTML tidy-up

/* ────────── hashing & PNG cache ────────── */
const hashString = (s: string): string => {
  let h = 5381; for (let i = 0; i < s.length; i++) h = (h << 5) + h + s.charCodeAt(i);
  return Math.abs(h).toString(16);
};

function diagramToPng(lang: 'plantuml' | 'mermaid', code: string): string {
  const out = path.join(WORK_DIR, `${hashString(code)}.png`);

  if (fs.existsSync(out)) {
    const buf = fs.readFileSync(out);
    if (buf.length >= 8 && buf.compare(PNG_MAGIC, 0, 8, 0, 8) === 0) return out;
    fs.unlinkSync(out);                                              // stale → regenerate
  }

  if (lang === 'plantuml') {
    const png = execFileSync('java', ['-jar', PLANTUML_JAR, '-tpng', '-pipe'],
                             { input: code, stdio: ['pipe','pipe','inherit'] });
    fs.writeFileSync(out, png);
  } else {
    execFileSync('mmdc', ['--input','-','--output',out,'--quiet'],
                 { input: code, stdio: ['pipe','ignore','inherit'] });
  }
  return out;
}

/* ────────── copy / hard-link PNGs into IMAGE_DIR ────────── */
const ensureDiagramInImageDir = (() => {
  const handled = new Set<string>();

  return (pngPath: string): string => {
    if (handled.has(pngPath)) return path.basename(pngPath);

    const targetDir  = IMAGE_DIR;
    const targetPath = path.join(targetDir, path.basename(pngPath));

    if (!fs.existsSync(targetPath)) {
      fs.mkdirSync(targetDir, { recursive: true });
      try { fs.linkSync(pngPath, targetPath); }
      catch { fs.copyFileSync(pngPath, targetPath); }
    }
    handled.add(pngPath);
    return path.basename(pngPath);
  };
})();

/* ═══════════════  PRE-PROCESSOR  ═══════════════ */

const makeStub = (file: string, params = '') =>
  `@@ATTACH|file=${path.basename(file)}${params ? `|${params}` : ''}@@`;

export function preprocess(
  md: string,
  diagGen = diagramToPng,
): string {
  const tree = unified().use(remarkParse).use(remarkDirective).parse(md);

  visit(tree, (node, idx, parent: Parent | undefined) => {
    /* ─── Diagrams ─────────────────────────────────────────── */
    if (node.type === 'code' &&
        (node.lang === 'plantuml' || node.lang === 'mermaid')) {
      const png   = diagGen(node.lang as any, (node as Code).value.trim());
      const file  = ensureDiagramInImageDir(png);
      (parent!.children as any)[idx!] = { type: 'html', value: makeStub(file) };
    }

    /* ─── Markdown images ──────────────────────────────────── */
    if (node.type === 'image') {
      const img    = node as Image;
      const base   = path.basename(img.url.split(/[?#]/)[0]);
      let params   = '';

      /* pick up `{ width=123;height=45 }` immediately after the image */
      if (parent && idx! + 1 < parent.children.length) {
        const next = parent.children[idx! + 1];
        if (next.type === 'text' && /^\{\s*[^}]+\s*\}/.test((next as any).value)) {
          params = (next as any).value.replace(/^\{\s*|\s*\}$/g, '');
          parent.children.splice(idx! + 1, 1);
        }
      }
      (parent!.children as any)[idx!] = { type: 'html', value: makeStub(base, params) };
    }

    /* ─── <img …> inside raw HTML ──────────────────────────── */
    if (node.type === 'html') {
      node.value = node.value.replace(
        /<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi,
        (_m: string, src: string): string => {
          const base   = path.basename(src.split(/[?#]/)[0]);
          const widthM = _m.match(/\bwidth=["'](\d+)(?:px)?["']/i);
          const params = widthM ? `width=${widthM[1]}` : '';
          return makeStub(base, params);
        });
    }
  });

  return unified().use(remarkStringify).stringify(tree);
}

/* ═══════════  MARKDOWN → HTML → XHTML  ═══════════ */

const markdownToHtml = (md: string) =>
  String(
    unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkDirective)
      .use(remarkRehype,   { allowDangerousHtml: true })
      .use(rehypeRaw)
      .use(rehypeStringify,{ allowDangerousHtml: true })
      .processSync(md),
  );

function replacePlaceholders(html: string): string {
  /* unwrap links around our stubs */
  html = html.replace(/<a[^>]*>(@@ATTACH\|file=[^@]+@@)<\/a>/gi, '$1');

  /* @@ATTACH|file=… → <ac:image …> */
  html = html.replace(
    /@@ATTACH\|file=([^|@]+)(?:\|([^@]+))?@@/gi,
    (_all, file, raw = '') => {
      const paramMap = Object.fromEntries(
        raw.split(';')
           .filter(Boolean)
           .map((p: string) => p.split('=').map((s: string) => s.trim()))
      ) as Record<string, string>;

      /* normalise widths/heights like “450px” → “450” */
      if (paramMap.width  ) paramMap.width  = paramMap.width.replace(/px$/i, '');
      if (paramMap.height ) paramMap.height = paramMap.height.replace(/px$/i, '');

      const attrs: string[] = [];
      if (paramMap.width )  attrs.push(`ac:width="${paramMap.width}"`);
      if (paramMap.height)  attrs.push(`ac:height="${paramMap.height}"`);
      if (attrs.length)     attrs.push('ac:thumbnail="true"');   // Server/DC needs this

      /* add native dimensions when available */
      try {
        const { width: w = 0, height: h = 0 } =
          imageSize(fs.readFileSync(path.join(IMAGE_DIR, file)));
        if (w) attrs.push(`ac:original-width="${w}"`);
        if (h) attrs.push(`ac:original-height="${h}"`);
      } catch {/* ignore if file is not local yet */ }

      const attrStr = attrs.length ? ' ' + attrs.join(' ') : '';
      return `<ac:image${attrStr}>\n  <ri:attachment ri:filename="${file}"/>\n</ac:image>`;
    });

  /* markdown ~~strike~~ → Confluence-friendly inline style */
  html = html.replace(/<del>(.*?)<\/del>/gi,
                      '<span style="text-decoration:line-through;">$1</span>');

  return html;
}



/* self-close void tags + wrap in Confluence namespace */
const wrapXhtml = (inner: string): string =>
  `<div xmlns:ac="http://atlassian.com/content" xmlns:ri="http://atlassian.com/resource/identifier">` +
    inner
      .replace(VOID_RE, (_, tag: string, rest = '') =>
        `<${tag}${(rest || '').trimEnd()}/>`)             // convert <hr> → <hr/>
      .replace(/&(?!(?:[a-z]+|#\d+);)/g, '&amp;') +      // escape naked &
  `</div>`;

/* ═══════════  TRANSFORMER CLASS  ═══════════ */

export class WritersideMarkdownTransformerDC extends MarkdownTransformer {
  constructor(schema: Schema = defaultSchema) { super(schema); }

  /** Confluence storage (XHTML) */
  toStorage(md: string) {
    const pre  = preprocess(md, diagramToPng);
    const html = markdownToHtml(pre);
    return {
      value: wrapXhtml(replacePlaceholders(html)),
      representation: 'storage' as const,
    };
  }

  /** Round-trip ADF (unchanged vs. Atlaskit) */
  toADF(md: string) {
    const pre   = preprocess(md, diagramToPng);
    const round = unified().use(remarkParse).processSync(pre).toString();
    return super.parse(round).toJSON();
  }
}
export default new WritersideMarkdownTransformerDC();