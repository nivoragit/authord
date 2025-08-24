/**********************************************************************
 * plugins/remark-confluence-media.ts
 * Single-pass MDAST transform — no placeholders, minimal regex:
 *  - ```mermaid``` → render → paragraph(image)
 *  - Markdown images → consume trailing {width=..;height=..} (manual scan)
 *  - Raw HTML is left alone (rehype-raw will turn it into HAST)
 *********************************************************************/

import type { Root as MdRoot, Code, Image as MdImage, Paragraph } from 'mdast';
import type { Parent, Node } from "npm:@types/unist@^3";
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { renderMermaidDefinitionToFile } from '../utils/mermaid.ts';
import { IMAGE_DIR, hashString, isPngFileOK } from '../utils/images.ts';
import process from "node:process";


function htmlImgToAttachStubs(s: string): string {
  // Minimal attribute picker (no heavy regex backtracking)
  return s.replace(/<img\b([^>]*?)\/?>/gi, (full, attrs) => {
    let src = '';
    let width: string | undefined;

    // scan attributes without nested regexps
    const A = attrs;
    // src=
    let m = /(?:\s|^)src\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(A);
    if (m) src = (m[2] ?? m[3] ?? m[4] ?? '').trim();

    // width=
    m = /(?:\s|^)width\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(A);
    if (m) {
      const raw = (m[2] ?? m[3] ?? m[4] ?? '').trim().replace(/px$/i, '');
      if (/^\d+$/.test(raw)) width = raw;
    }

    if (!src) return full; // keep as-is if no src

    const file = path.basename(src.split(/[?#]/)[0]);
    const params = width ? `|width=${width}` : '';
    return `@@ATTACH|file=${file}${params}@@`;
  });
}

/** Consume one or more leading `{...}` groups from the next text sibling; return width/height map. */
function takeParamHintsAfter(parent: Parent, idx: number): { width?: string; height?: string } {
  const kids: any[] = (parent as any).children ?? [];
  if (idx + 1 >= kids.length) return {};
  const next = kids[idx + 1];
  if (!next || next.type !== 'text' || typeof next.value !== 'string') return {};

  let s = next.value as string;
  let consumed = 0;
  const params: { width?: string; height?: string } = {};

  // helper: scan one {...} group; returns content or null if not a well-formed group
  const scanGroup = () => {
    let i = 0;
    while (i < s.length && s[i] === ' ') i++;
    if (s[i] !== '{') return null;
    i++; // skip '{'
    const start = i;
    while (i < s.length && s[i] !== '}') i++;
    if (i >= s.length || s[i] !== '}') return null; // no closing brace
    const inside = s.slice(start, i);
    const len = i + 1; // include closing '}'
    consumed += len;
    s = s.slice(len);
    return inside;
  };

  let inside: string | null;
  while ((inside = scanGroup()) !== null) {
    // tokenize inside by spaces/semicolons without regex
    let tok = '';
    const tokens: string[] = [];
    for (let i = 0; i < inside.length; i++) {
      const ch = inside[i];
      if (ch === ' ' || ch === ';' || ch === '\t' || ch === '\n' || ch === '\r') {
        if (tok) { tokens.push(tok); tok = ''; }
      } else {
        tok += ch;
      }
    }
    if (tok) tokens.push(tok);

    for (const t of tokens) {
      const eq = t.indexOf('=');
      if (eq <= 0) continue;
      const k = t.slice(0, eq).trim().toLowerCase();
      let v = t.slice(eq + 1).trim();
      if (k !== 'width' && k !== 'height') continue;
      // strip trailing px
      if (v.endsWith('px')) v = v.slice(0, -2);
      // keep pure integer only
      let j = 0; while (j < v.length && v.charCodeAt(j) >= 48 && v.charCodeAt(j) <= 57) j++;
      if (j === 0 || j !== v.length) continue;
      (params as any)[k] = v;
    }
  }

  if (consumed > 0) {
    if (s.length === 0) kids.splice(idx + 1, 1);
    else kids[idx + 1].value = s;
  }
  return params;
}

/** Wrap an mdast image into a paragraph so it renders as a block (replacing a code block). */
function paragraphOfImage(img: MdImage): Paragraph {
  return { type: 'paragraph', children: [img] };
}

/** Set width/height as hProperties so remark-rehype emits them on <img>. */
function setImageDims(img: MdImage, dims: { width?: string; height?: string }) {
  const hp: any = ((img as any).data ??= {}).hProperties ??= {};
  if (dims.width)  hp.width  = dims.width;
  if (dims.height) hp.height = dims.height;
}

export function remarkConfluenceMedia() {
  return async function transformer(tree: MdRoot) {
    const tasks: Promise<void>[] = [];

    function walk(node: Node, parent?: Parent, index?: number) {
      switch (node.type) {
        case 'code': {
          const code = node as Code;
          if (code.lang === 'mermaid' && parent && typeof index === 'number') {
            tasks.push((async () => {
              const def = (code.value || '').trim();
              const out = path.join(IMAGE_DIR, `${hashString('mermaid::' + def)}.png`);
              let png: string | null = null;

              if (fs.existsSync(out) && isPngFileOK(out)) {
                png = out;
              } else {
                try {
                  await renderMermaidDefinitionToFile(def, out, {
                    width: process.env.MMD_WIDTH ? Number(process.env.MMD_WIDTH) : undefined,
                    height: process.env.MMD_HEIGHT ? Number(process.env.MMD_HEIGHT) : undefined,
                    scale: process.env.MMD_SCALE ? Number(process.env.MMD_SCALE) : undefined,
                    backgroundColor: process.env.MMD_BG,
                    theme: process.env.MMD_THEME,
                    configFile: process.env.MMD_CONFIG,
                    quiet: true,
                  });
                  if (!isPngFileOK(out)) throw new Error('bad png');
                  png = out;
                } catch {
                  try { if (fs.existsSync(out)) await fsp.unlink(out); } catch {}
                  png = null;
                }
              }

              if (png) {
                const fileName = path.basename(png);
                const img: MdImage = { type: 'image', url: fileName, alt: '' };
                (parent as any).children[index] = paragraphOfImage(img);
              }
            })());
            return;
          }
          break;
        }

        case 'image': {
          if (parent && typeof index === 'number') {
            const img = node as MdImage;
            // consume `{width=..;height=..}` hints after the image
            const dims = takeParamHintsAfter(parent, index);
            if (dims.width || dims.height) setImageDims(img, dims);
          }
          break;
        }

        case 'html': {
          // node is a raw HTML *string* in MDAST. Replace <img> substrings with stubs.
          if (parent && typeof index === 'number') {
            const n: any = node;
            if (typeof n.value === 'string') {
              n.value = htmlImgToAttachStubs(n.value);
            }
          }
          break;
        }

      }

      const anyNode = node as any;
      if (Array.isArray(anyNode.children)) {
        for (let i = 0; i < anyNode.children.length; i++) walk(anyNode.children[i], anyNode, i);
      }
    }

    walk(tree as any);
    await Promise.all(tasks);
  };
}
