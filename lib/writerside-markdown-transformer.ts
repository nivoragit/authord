/**********************************************************************
 * writerside-markdown-transformer.ts
 * Confluence DC/Server — strict-XHTML + auto-copied diagrams
 *
 * Mermaid rendering: CLI via `mmdc` executable through utils/mermaid.ts
 * Caches PNGs, links into IMAGE_DIR so imageSize() works
 *********************************************************************/

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkDirective from 'remark-directive';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import rehypeRaw from 'rehype-raw';

import type { Parent, Node as UnistNode } from "npm:@types/unist@^3";
import type { Image, Code } from 'mdast';

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as process from 'node:process';
import { imageSize } from 'image-size';

// Centralized Mermaid utilities (mmdc executable)
import { Buffer } from "node:buffer";
import { renderMermaidDefinitionToFile } from "./utils/mermaid.ts";

/* ═════════════════  CONSTANTS & HELPERS  ═════════════════ */

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

export let IMAGE_DIR = process.env.AUTHORD_IMAGE_DIR ||
  path.resolve(process.cwd(), 'images');

export function setImageDir(dir: string) {
  IMAGE_DIR = dir;
}
const VOID_RE = /<(hr|br|img|input|meta|link)(\s[^/>]*)?>/gi;          // XHTML tidy-up

/* ────────── hashing & PNG cache ────────── */
const hashString = (s: string): string => {
  let h = 5381; for (let i = 0; i < s.length; i++) h = (h << 5) + h + s.charCodeAt(i);
  return Math.abs(h).toString(16);
};

function isPngFileOK(p: string): boolean {
  try {
    const buf = fs.readFileSync(p);
    return buf.length >= 8 && buf.compare(PNG_MAGIC, 0, 8, 0, 8) === 0;
  } catch { return false; }
}

/* ═════════════  MERMAID via central utils (mmdc)  ═════════════ */

async function renderMermaidPngTo(outFile: string, definition: string): Promise<void> {
  const opts = {
    // Pull sizing/theming from env if present
    width: process.env.MMD_WIDTH ? Number(process.env.MMD_WIDTH) : undefined,
    height: process.env.MMD_HEIGHT ? Number(process.env.MMD_HEIGHT) : undefined,
    scale: process.env.MMD_SCALE ? Number(process.env.MMD_SCALE) : undefined,
    backgroundColor: process.env.MMD_BG,
    theme: process.env.MMD_THEME,
    configFile: process.env.MMD_CONFIG,
    quiet: true,
  } as const;

  await renderMermaidDefinitionToFile(definition, outFile, opts);
}

/* ────────── copy / hard-link PNGs into IMAGE_DIR ────────── */
const ensureDiagramInImageDir = (() => {
  const handled = new Set<string>();
  return (pngPath: string): string => {
    if (handled.has(pngPath)) return path.basename(pngPath);

    const targetDir = IMAGE_DIR;
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

/* ═══════════════  PRE-PROCESSOR (ASYNC)  ═══════════════ */

const makeStub = (file: string, params = '') =>
  `@@ATTACH|file=${path.basename(file)}${params ? `|${params}` : ''}@@`;

/** Async diagram generator: returns path to cached PNG or null to keep code block. */
async function diagramToPngAsync(definition: string): Promise<string | null> {
  const out = path.join(IMAGE_DIR, `${hashString('mermaid::' + definition)}.png`);

  // Use cache if present and valid
  if (fs.existsSync(out) && isPngFileOK(out)) return out;

  try {
    await renderMermaidPngTo(out, definition);
    if (!isPngFileOK(out)) throw new Error('mmdc produced invalid PNG');
    return out;
  } catch {
    try { if (fs.existsSync(out)) await fsp.unlink(out); } catch { /* ignore */ }
    return null;
  }
}

function extractSizeParamsAfterImage(parent: Parent | undefined, idx: number): string {
  if (!parent || idx + 1 >= (parent.children?.length ?? 0)) return '';
  const next = (parent.children as any)[idx + 1];
  if (next?.type === 'text' && /^\{\s*[^}]+\s*\}/.test(next.value)) {
    (parent.children as any).splice(idx + 1, 1);
    return String(next.value).replace(/^\{\s*|\s*\}$/g, '');
  }
  return '';
}

/** Walk the mdast tree asynchronously and convert images/diagrams to stubs. */
async function preprocess(md: string): Promise<string> {
  const tree: any = unified().use(remarkParse).use(remarkDirective).parse(md);

  async function visitNode(node: UnistNode, parent?: Parent, index?: number): Promise<void> {
    // Code blocks → Mermaid diagrams
    if (node.type === 'code' && (node as any).lang === 'mermaid') {
      const png = await diagramToPngAsync((node as Code).value.trim());
      if (png && parent && typeof index === 'number') {
        const file = ensureDiagramInImageDir(png);
        (parent.children as any)[index] = { type: 'html', value: makeStub(file) };
      }
      return; // done
    }

    // Markdown images → attachment stubs with optional size params
    if (node.type === 'image' && parent && typeof index === 'number') {
      const img = node as Image;
      const base = path.basename(String(img.url).split(/[?#]/)[0]);
      const params = extractSizeParamsAfterImage(parent, index);
      (parent.children as any)[index] = { type: 'html', value: makeStub(base, params) };
      return;
    }

    // Raw HTML with <img> → convert to attachment stubs
    if (node.type === 'html') {
      (node as any).value = String((node as any).value).replace(
        /<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi,
        (_m: string, src: string): string => {
          const base = path.basename(src.split(/[?#]/)[0]);
          const widthM = _m.match(/\bwidth=["'](\d+)(?:px)?["']/i);
          const params = widthM ? `width=${widthM[1]}` : '';
          return makeStub(base, params);
        });
      // continue to children if any
    }

    // Recurse into children
    const anyNode = node as any;
    if (Array.isArray(anyNode.children)) {
      for (let i = 0; i < anyNode.children.length; i++) {
        await visitNode(anyNode.children[i], anyNode, i);
      }
    }
  }

  await visitNode(tree as any);
  return unified().use(remarkStringify).stringify(tree);
}

/* ═══════════  MARKDOWN → HTML → XHTML  ═══════════ */

const markdownToHtml = (md: string) =>
  String(
    unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkDirective)
      .use(remarkRehype, { allowDangerousHtml: true })
      .use(rehypeRaw)
      .use(rehypeStringify, { allowDangerousHtml: true })
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
      if (paramMap.width) paramMap.width = paramMap.width.replace(/px$/i, '');
      if (paramMap.height) paramMap.height = paramMap.height.replace(/px$/i, '');

      const attrs: string[] = [];
      if (paramMap.width) attrs.push(`ac:width="${paramMap.width}"`);
      if (paramMap.height) attrs.push(`ac:height="${paramMap.height}"`);
      if (attrs.length) attrs.push('ac:thumbnail="true"');   // Server/DC needs this

      /* add native dimensions when available */
      try {
        const { width: w = 0, height: h = 0 } =
          imageSize(fs.readFileSync(path.join(IMAGE_DIR, file)) as any) as any;
        if (w) attrs.push(`ac:original-width="${w}"`);
        if (h) attrs.push(`ac:original-height="${h}"`);
      } catch { /* ignore if file is not local yet */ }

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
    .replace(VOID_RE, (_: string, tag: string, rest = '') =>
      `<${tag}${(rest || '').trimEnd()}/>`)             // convert <hr> → <hr/>
    .replace(/&(?!(?:[a-z]+|#\d+);)/g, '&amp;') +      // escape naked &
  `</div>`;

/* ═══════════  TRANSFORMER CLASS (ASYNC)  ═══════════ */

export class WritersideMarkdownTransformerDC {
  /** Confluence storage (XHTML) — async */
  async toStorage(md: string) {
    const pre = await preprocess(md);
    const html = markdownToHtml(pre);
    return {
      value: wrapXhtml(replacePlaceholders(html)),
      representation: 'storage' as const,
    };
  }
}
