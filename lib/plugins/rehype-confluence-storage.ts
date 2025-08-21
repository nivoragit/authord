/**********************************************************************
 * src/plugins/rehype-confluence-storage.ts
 * Single-pass HAST transform to Confluence/DC storage XHTML.
 *
 * What it does in ONE walk:
 *  - <img src="..."> → <ac:image><ri:attachment/></ac:image>
 *    (uses width/height props; also reads inline style width/height px)
 *  - GFM checkbox <input type="checkbox"> → literal "[ ]"/"[x]"
 *    and strip task-list classes from <ul>/<li>
 *  - Unwrap <a> around a single ac:image child
 *  - <del> → <span style="text-decoration:line-through;">
 *  - Normalize props to XML-safe values (booleans, arrays), keep className tokenized
 *  - Force HTML void elements to self-close
 *  - Wrap once with Confluence namespaces
 *  - Inject a TOC macro (once) at the top (configurable)
 *********************************************************************/

import type { Root as HtmlRoot, Element, Properties } from "npm:@types/hast@^3";;
import * as fs from 'node:fs';
import * as path from 'node:path';
import { imageSize } from 'image-size';
import { IMAGE_DIR } from '../utils/images.ts';

const HTML_VOID = new Set([
  'area','base','br','col','embed','hr','img','input','keygen','link','meta','param','source','track','wbr'
]);

export interface RehypeConfluenceStorageOptions {
  /** Insert a TOC macro (default true) */
  insertToc?: boolean;
  /** Position to insert TOC: 'top' (default) or 'after-first-h1' */
  tocPosition?: 'top' | 'after-first-h1';
  /** Macro id to use (default provided) */
  tocMacroId?: string;
  /** Max heading level (default 3) */
  tocMaxLevel?: number;
}

/* ───────────────────────── helpers ───────────────────────── */

function getClassList(props: Record<string, any>): string[] {
  const cls = props.className ?? props.class;
  if (Array.isArray(cls)) return cls.slice();
  if (typeof cls === 'string') return cls.trim().split(/\s+/).filter(Boolean);
  return [];
}
function setClassList(props: Record<string, any>, tokens: string[]) {
  if (!tokens || tokens.length === 0) {
    delete props.className; delete props.class; return;
  }
  props.className = tokens; delete props.class;
}

/** Parse width/height from inline style string (e.g., "width:290px;height:100px") */
function readSizeFromStyle(style: unknown): { w?: string; h?: string } {
  if (typeof style !== 'string' || !style) return {};
  let w: string | undefined; let h: string | undefined;

  // Tiny manual tokenizer (no heavy regex): key:value; pairs
  for (const decl of style.split(';')) {
    const i = decl.indexOf(':'); if (i <= 0) continue;
    const key = decl.slice(0, i).trim().toLowerCase();
    let val = decl.slice(i + 1).trim();
    if (key !== 'width' && key !== 'height') continue;
    if (val.endsWith('px')) val = val.slice(0, -2);
    if (/^\d+$/.test(val)) {
      if (key === 'width') w = val; else h = val;
    }
  }
  return { w, h };
}

/** Build <ac:image> element from img src + optional dims, with original size if available */
function makeAcImageFromSrc(src: string, width?: string | number, height?: string | number, style?: unknown): Element {
  const file = path.basename(String(src).split(/[?#]/)[0]);
  const props: Properties = {};

  // Width/height precedence: explicit width/height props, then style
  const styleSz = readSizeFromStyle(style);
  const wStr = (typeof width === 'number' ? String(width) : typeof width === 'string' ? width : styleSz.w);
  const hStr = (typeof height === 'number' ? String(height) : typeof height === 'string' ? height : styleSz.h);

  if (wStr && /^\d+$/.test(wStr)) props['ac:width'] = wStr;
  if (hStr && /^\d+$/.test(hStr)) props['ac:height'] = hStr;
  if (props['ac:width'] || props['ac:height']) props['ac:thumbnail'] = 'true';

  try {
    const { width: ow = 0, height: oh = 0 } =
      imageSize(fs.readFileSync(path.join(IMAGE_DIR, file)) as any) as any;
    if (ow) (props as any)['ac:original-width'] = String(ow);
    if (oh) (props as any)['ac:original-height'] = String(oh);
  } catch { /* ignore if file not found locally */ }

  return {
    type: 'element',
    tagName: 'ac:image',
    properties: props,
    children: [{
      type: 'element',
      tagName: 'ri:attachment',
      properties: { 'ri:filename': file },
      children: [],
      // ensure <ri:attachment .../> with self-closing serializer
      // @ts-ignore
      selfClosing: true,
    }]
  };
}

function hasTocMacroAnywhere(node: any): boolean {
  let found = false;
  (function scan(n: any) {
    if (found || !n) return;
    if (n.type === 'element' && n.tagName === 'ac:structured-macro' && n.properties?.['ac:name'] === 'toc') {
      found = true; return;
    }
    const kids = n.children;
    if (Array.isArray(kids)) for (const k of kids) scan(k);
  })(node);
  return found;
}

function buildTocMacro(macroId: string, maxLevel: number): Element {
  return {
    type: 'element',
    tagName: 'ac:structured-macro',
    properties: {
      'ac:name': 'toc',
      'ac:schema-version': '1',
      'ac:macro-id': macroId,
    },
    children: [{
      type: 'element',
      tagName: 'ac:parameter',
      properties: { 'ac:name': 'maxLevel' },
      children: [{ type: 'text', value: String(maxLevel) }],
    }],
  };
}

/* ───────────────────────── main plugin ───────────────────────── */

export function rehypeConfluenceStorage(opts: RehypeConfluenceStorageOptions = {}) {
  const insertToc = opts.insertToc !== false; // default true
  const tocPos = opts.tocPosition ?? 'top';
  const tocMacroId = opts.tocMacroId ?? 'a854a720-dea6-4d0f-a0a2-e4591c07d85e';
  const tocMaxLevel = Number.isFinite(opts.tocMaxLevel) ? Number(opts.tocMaxLevel) : 3;

  return function transformer(tree: HtmlRoot) {
    function walk(node: any, parent?: any, index?: number) {
      if (node?.type !== 'element') return;

      const el = node as Element;
      const props = (el.properties || {}) as Record<string, any>;

      /* 1) GFM checkbox inputs → literal "[ ]"/"[x]" (remove <input>) */
      if (el.tagName === 'input' && props.type === 'checkbox' && parent && typeof index === 'number') {
        const checked = ('checked' in props) || props['aria-checked'] === 'true';
        parent.children[index] = { type: 'text', value: checked ? '[x]' : '[ ]' };
        return;
      }

      /* 2) Strip GFM task list classes on <ul>/<li> while className is still tokenized */
      if (el.tagName === 'ul' || el.tagName === 'li') {
        const tokens = getClassList(props);
        const kept = tokens.filter(t => t !== 'contains-task-list' && t !== 'task-list-item');
        setClassList(props, kept);
      }

      /* 3) <img> (MD & raw HTML) → <ac:image> */
      if (el.tagName === 'img' && parent && typeof index === 'number') {
        const src = props.src ?? '';
        parent.children[index] = makeAcImageFromSrc(src, props.width, props.height, props.style);
        return;
      }

      /* 4) Recurse exactly once */
      if (Array.isArray(el.children)) {
        for (let i = 0; i < el.children.length; i++) walk(el.children[i], el, i);
      }

      /* 5) Unwrap <a> around a single <ac:image> child */
      if (el.tagName === 'a' && parent && typeof index === 'number' && el.children.length === 1) {
        const only = el.children[0] as any;
        if (only?.type === 'element' && only.tagName === 'ac:image') {
          parent.children[index] = only;
          return;
        }
      }

      /* 6) <del> → <span style="text-decoration:line-through;"> */
      if (el.tagName === 'del') {
        el.tagName = 'span';
        const style = String((props.style as string) || '');
        el.properties = {
          ...props,
          style: style
            ? (style.includes('text-decoration') ? style : `${style};text-decoration:line-through;`)
            : 'text-decoration:line-through;'
        };
      }

      /* 7) Force XML-style self-closing for HTML voids */
      if (HTML_VOID.has(el.tagName)) {
        el.children = [];
        // @ts-ignore
        el.selfClosing = true;
      }

      /* 8) Normalize props to XML-safe values (skip className/class) */
      if (el.properties) {
        for (const key of Object.keys(props)) {
          if (key === 'className' || key === 'class') continue; // keep tokens array
          const val = props[key];
          if (val === true || val === '') props[key] = key;        // boolean → key="key"
          else if (val == null) delete props[key];                  // drop null/undefined
          else if (Array.isArray(val)) props[key] = val.join(' ');  // other arrays → string
          // leave numbers/strings as-is
        }
      }
    }

    // Single top-level pass over current children
    for (let i = 0; i < tree.children.length; i++) walk(tree.children[i], tree, i);

    // Optionally add a TOC macro once (avoid duplicates)
    const shouldAddToc = insertToc && !hasTocMacroAnywhere(tree);
    const toc = shouldAddToc ? buildTocMacro(tocMacroId, tocMaxLevel) : null;

    // Build wrapper with namespaces; inject TOC according to position
    const originalChildren = tree.children as any[];
    let wrappedChildren: any[];

    if (toc && tocPos === 'after-first-h1') {
      let inserted = false;
      wrappedChildren = [];
      for (let i = 0; i < originalChildren.length; i++) {
        const child = originalChildren[i];
        wrappedChildren.push(child);
        if (!inserted && child?.type === 'element' && child.tagName === 'h1') {
          wrappedChildren.push(toc);
          inserted = true;
        }
      }
      if (!inserted) wrappedChildren.unshift(toc);
    } else if (toc) {
      wrappedChildren = [toc, ...originalChildren];
    } else {
      wrappedChildren = originalChildren;
    }

    const wrapper: Element = {
      type: 'element',
      tagName: 'div',
      properties: {
        'xmlns:ac': 'http://atlassian.com/content',
        'xmlns:ri': 'http://atlassian.com/resource/identifier',
      },
      children: wrappedChildren as any
    };

    tree.children = [wrapper];
  };
}
