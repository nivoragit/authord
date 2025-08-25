/**
 * Rehype plugin: HAST → Confluence/DC storage XHTML.
 *
 * Key points:
 *  - Single-pass visit from root children
 *  - Minimal regex
 *  - Memoized image-size I/O; Deno.readFileSync-first with Node fallback
 *  - Handles: <img>→<ac:image>, Writerside @@ATTACH (border-effect), trailing `{...}` blocks,
 *             GFM task lists, <del>→<span style="text-decoration:line-through;">, unwrap <a><ac:image/></a>,
 *             self-close voids, TOC injection (top/after-first-h1), CDATA fixes in <code-block lang="xml">
 */

import * as fs from "node:fs"; // fallback when Deno isn't available
import { imageSize } from "npm:image-size@1";
import { IMAGE_DIR } from "../utils/images.ts";

type HNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, any>;
  children?: HNode[];
  value?: string;
  selfClosing?: boolean;
};
type HRoot = HNode;

export interface RehypeConfluenceOptions {
  insertToc?: boolean;
  tocMacroId?: string;
  tocMaxLevel?: number;
  tocPosition?: "top" | "after-first-h1";
}

const HTML_VOID = new Set([
  "area","base","br","col","embed","hr","img","input","keygen","link","meta","param","source","track","wbr",
]);

/* ────────────── Deno/Node I/O, basename, tokens ────────────── */

function readFileSyncCompat(filePath: string): Uint8Array | null {
  try {
    // @ts-ignore
    if (typeof Deno !== "undefined" && Deno.readFileSync) {
      // @ts-ignore
      return Deno.readFileSync(filePath);
    }
  } catch {}
  try { return fs.readFileSync(filePath); } catch { return null; }
}

function basenameFromSrc(src: string): string {
  let s = String(src);
  const q = s.indexOf("?"); if (q >= 0) s = s.slice(0, q);
  const h = s.indexOf("#"); if (h >= 0) s = s.slice(0, h);
  let i = s.length - 1;
  for (; i >= 0; i--) {
    const c = s.charCodeAt(i);
    if (c === 47 /*/ */ || c === 92 /*\ */) break;
  }
  return s.slice(i + 1);
}

function isDigits(str: string | undefined | null): str is string {
  if (!str || str.length === 0) return false;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
}

function getClassList(props: Record<string, any>): string[] {
  const cls = props.className ?? props.class;
  if (Array.isArray(cls)) return cls.slice();
  if (typeof cls === "string") {
    const out: string[] = [];
    let token = "";
    for (let i = 0; i < cls.length; i++) {
      const ch = cls[i];
      if (/\s/.test(ch)) { if (token) { out.push(token); token = ""; } }
      else token += ch;
    }
    if (token) out.push(token);
    return out;
  }
  return [];
}
function setClassList(props: Record<string, any>, tokens: string[]) {
  if (!tokens || tokens.length === 0) { delete props.className; delete props.class; }
  else { props.className = tokens; delete props.class; }
}

function readSizeFromStyle(style: unknown): { w?: string; h?: string } {
  if (typeof style !== "string" || !style) return {};
  let w: string | undefined; let h: string | undefined;
  for (const decl of style.split(";")) {
    const i = decl.indexOf(":"); if (i <= 0) continue;
    const key = decl.slice(0, i).trim().toLowerCase();
    let val = decl.slice(i + 1).trim().toLowerCase();
    if (key !== "width" && key !== "height") continue;
    if (val.endsWith("px")) val = val.slice(0, -2);
    if (isDigits(val)) { if (key === "width" && w == null) w = val; if (key === "height" && h == null) h = val; }
  }
  return { w, h };
}
function normalizePx(v: unknown): string | undefined {
  if (typeof v === "number") return String(v);
  if (typeof v === "string") {
    let s = v.trim().toLowerCase();
    if (s.endsWith("px")) s = s.slice(0, -2);
    return isDigits(s) ? s : undefined;
  }
  return undefined;
}

/* ────────────── memoized image sizes ────────────── */
const sizeCache = new Map<string, { w?: number; h?: number }>();
function getOriginalSize(file: string): { w?: number; h?: number } {
  if (sizeCache.has(file)) return sizeCache.get(file)!;
  try {
    const buf = readFileSyncCompat(`${IMAGE_DIR}/${file}`);
    if (buf) {
      const { width, height } = imageSize(buf as any) as any;
      const out = { w: width || undefined, h: height || undefined };
      sizeCache.set(file, out);
      return out;
    }
  } catch {}
  const out = { w: undefined, h: undefined };
  sizeCache.set(file, out);
  return out;
}

/* ────────────── Writerside/XML helpers ────────────── */

function parseTagAttributes(attrStr: string): Record<string, string> {
  const out: Record<string, string> = {};
  const n = attrStr.length;
  let i = 0;
  const ws = /\s/;
  const skipWs = () => { while (i < n && ws.test(attrStr[i]!)) i++; };

  while (i < n) {
    skipWs();
    let key = "";
    while (i < n) {
      const ch = attrStr[i]!;
      if (ws.test(ch) || ch === "=" || ch === ">" || ch === "/") break;
      key += ch; i++;
    }
    if (!key) { i++; continue; }
    skipWs();
    if (attrStr[i] !== "=") { out[key.toLowerCase()] = key.toLowerCase(); continue; }
    i++; skipWs();

    let val = "";
    const q = attrStr[i];
    if (q === `"` || q === `'`) {
      i++;
      while (i < n && attrStr[i] !== q) { val += attrStr[i]!; i++; }
      if (i < n && attrStr[i] === q) i++;
    } else {
      while (i < n && !ws.test(attrStr[i]!) && attrStr[i] !== ">") { val += attrStr[i]!; i++; }
    }
    out[key.toLowerCase()] = val;
  }
  return out;
}

function replaceImgTagsWithAttach(text: string): string {
  let out = "";
  const n = text.length;
  let i = 0;

  while (i < n) {
    const lt = text.indexOf("<", i);
    if (lt < 0) { out += text.slice(i); break; }
    out += text.slice(i, lt);

    if (text.slice(lt + 1, lt + 4).toLowerCase() === "img") {
      let j = lt + 4, attrs = "";
      while (j < n) { const ch = text[j]!; if (ch === ">") { j++; break; } attrs += ch; j++; }
      const kv = parseTagAttributes(attrs);
      const file = basenameFromSrc(kv["src"] || "");
      const w = normalizePx(kv["width"]);
      const parts = [`@@ATTACH|file=${file}`];
      if (w) parts.push(`width=${w}`);
      out += parts.join("|") + "@@";
      i = j;
    } else {
      out += "<"; i = lt + 1;
    }
  }
  return out;
}

function rewriteAnyCdataText(text: string): string | null {
  const openRaw = text.indexOf("<![CDATA[");
  const openCom = text.indexOf("<!--[CDATA[");
  const openIdx = (openRaw >= 0 && (openCom < 0 || openRaw < openCom)) ? openRaw : openCom;
  if (openIdx < 0) return null;

  const openLen = (openIdx === openRaw) ? "<![CDATA[".length : "<!--[CDATA[".length;
  const closeRaw = text.lastIndexOf("]]>");
  const closeCom = text.lastIndexOf("]]-->");
  const closeIdx = Math.max(closeRaw, closeCom);
  if (closeIdx < 0 || closeIdx <= openIdx + openLen) return null;

  const inner = text.slice(openIdx + openLen, closeIdx);
  const replaced = replaceImgTagsWithAttach(inner);
  return `<!--[CDATA[${replaced}]]-->`;
}

function collectCodeBlockText(n: HNode): string {
  if (!n || n.type !== "element" || !Array.isArray(n.children)) return "";
  let out = "";
  const push = (node: HNode | null | undefined) => {
    if (!node) return;
    if (node.type === "text" && typeof (node as any).value === "string") out += String((node as any).value);
    else if (node.type === "comment" && typeof (node as any).value === "string") out += `<!--${String((node as any).value)}-->`;
    else if (node.type === "element" && Array.isArray(node.children)) for (const gc of node.children) push(gc as HNode);
  };
  for (const ch of n.children) push(ch as HNode);
  return out;
}

function rewriteCodeBlockCdata(el: HNode) {
  if (!el || el.type !== "element" || (el.tagName || "").toLowerCase() !== "code-block") return;
  const props = el.properties || {};
  const lang = (props.lang ?? props.language ?? "").toString().toLowerCase();
  if (lang !== "xml" || !Array.isArray(el.children)) return;

  const buf = collectCodeBlockText(el);
  let rewritten = rewriteAnyCdataText(buf);
  if (rewritten == null && buf.indexOf("<img") >= 0) {
    const inner = replaceImgTagsWithAttach(buf);
    rewritten = `<!--[CDATA[${inner}]]-->`;
  }
  if (rewritten != null) {
    const commentValue = rewritten.replace(/^<!--\[CDATA\[/, "[CDATA[").replace(/\]\]-->$/, "]]");
    el.children = [{ type: "comment", value: commentValue }];
  }
}

/* ────────────── trailing {width=.. height=..} blocks ────────────── */

function collectPlainText(n: HNode): string {
  if (!n) return "";
  if (n.type === "text" && typeof (n as any).value === "string") return String((n as any).value);
  if (Array.isArray(n.children)) { let s = ""; for (const ch of n.children) s += collectPlainText(ch as HNode); return s; }
  return "";
}

function consumeAttrBlocksFromFollowingText(
  parent: HNode,
  startIndex: number,
): { w?: string; h?: string; consumed: boolean } {
  const kids = parent.children || [];

  // Collect ONLY consecutive text nodes after the image/custom-image.
  // Do NOT skip over any elements (even if visually empty).
  const textSegs: { idx: number; node: HNode; text: string }[] = [];
  let i = startIndex + 1;
  while (i < kids.length) {
    const n = kids[i]!;
    if (n.type === "text" && typeof (n as any).value === "string") {
      textSegs.push({ idx: i, node: n, text: String((n as any).value) });
      i++;
      continue;
    }
    break; // stop at first non-text sibling
  }

  if (textSegs.length === 0) return { consumed: false };

  // Stitch text
  let buf = "";
  for (const s of textSegs) buf += s.text;

  // Parse one-or-more `{...}` blocks ONLY if each has a closing `}` in buf.
  let pos = 0;
  let w: string | undefined;
  let h: string | undefined;
  let consumedAny = false;

  while (pos < buf.length) {
    // skip whitespace
    while (pos < buf.length && /\s/.test(buf[pos]!)) pos++;
    if (buf[pos] !== "{") break;

    // Require a matching closing brace in the combined text buffer.
    const close = buf.indexOf("}", pos + 1);
    if (close === -1) break; // unterminated → bail completely (leave literal text)

    const inner = buf.slice(pos + 1, close);

    // tokens: k:v or k=v separated by spaces/commas
    let token = "";
    const tokens: string[] = [];
    for (let j = 0; j < inner.length; j++) {
      const ch = inner[j]!;
      if (ch === " " || ch === "\t" || ch === ",") {
        if (token) {
          tokens.push(token);
          token = "";
        }
      } else {
        token += ch;
      }
    }
    if (token) tokens.push(token);

    for (const kv of tokens) {
      const eq = kv.indexOf(":") >= 0 ? kv.indexOf(":") : kv.indexOf("=");
      if (eq <= 0) continue;
      const k = kv.slice(0, eq).trim().toLowerCase();
      let v = kv.slice(eq + 1).trim().toLowerCase();
      if (v.endsWith("px")) v = v.slice(0, -2);
      if (isDigits(v)) {
        if (k === "width" && w == null) w = v;
        if (k === "height" && h == null) h = v;
      }
    }

    pos = close + 1; // advance past '}'
    consumedAny = true;
  }

  if (!consumedAny) return { consumed: false };

  // Reflect consumed prefix (up to 'pos') back into the actual text nodes.
  let remaining = pos;
  for (const s of textSegs) {
    const len = s.text.length;
    if (remaining <= 0) break;
    if (remaining >= len) {
      (s.node as any).value = "";
      remaining -= len;
    } else {
      (s.node as any).value = s.text.slice(remaining);
      remaining = 0;
      break;
    }
  }

  // Remove text nodes that became empty (no element removals).
  for (let k = textSegs.length - 1; k >= 0; k--) {
    const s = textSegs[k];
    if (((s.node as any).value || "") === "") kids.splice(s.idx, 1);
  }

  return { w, h, consumed: true };
}


/* ────────────── ac:image / @@ATTACH builders ────────────── */

function makeAcImageFromSrc(
  src: string,
  width?: string | number,
  height?: string | number,
  style?: unknown,
  alt?: string,
): HNode {
  const file = basenameFromSrc(src);
  const props: Record<string, any> = {};
  const styleSz = readSizeFromStyle(style);

  const wStr =
    typeof width === "number" ? String(width)
    : typeof width === "string" ? normalizePx(width)
    : styleSz.w;
  const hStr =
    typeof height === "number" ? String(height)
    : typeof height === "string" ? normalizePx(height)
    : styleSz.h;

  if (wStr && isDigits(wStr)) props["ac:width"] = wStr;
  if (hStr && isDigits(hStr)) props["ac:height"] = hStr;
  if (props["ac:width"] || props["ac:height"]) props["ac:thumbnail"] = "true";

  const { w: ow, h: oh } = getOriginalSize(file);
  if (ow) props["ac:original-width"] = String(ow);
  if (oh) props["ac:original-height"] = String(oh);
  if (alt) props.alt = String(alt);

  return {
    type: "element",
    tagName: "ac:image",
    properties: props,
    children: [{
      type: "element",
      tagName: "ri:attachment",
      properties: { "ri:filename": file },
      children: [],
      selfClosing: true,
    }],
  };
}

function convertImgToAttachToken(imgProps: Record<string, any>): HNode {
  const src = String(imgProps.src ?? "").trim();
  const file = basenameFromSrc(src);
  const width = normalizePx(imgProps.width);
  const parts = [`@@ATTACH|file=${file}`];
  if (width) parts.push(`width=${width}`);
  return { type: "text", value: parts.join("|") + "@@" };
}

/* ────────────── TOC helpers ────────────── */

function hasTocMacro(el: HNode): boolean {
  return (
    el.type === "element" &&
    el.tagName === "ac:structured-macro" &&
    (el.properties || {})["ac:name"] === "toc"
  );
}
function buildTocMacro(macroId: string, maxLevel: number): HNode {
  return {
    type: "element",
    tagName: "ac:structured-macro",
    properties: { "ac:name": "toc", "ac:schema-version": "1", "ac:macro-id": macroId },
    children: [{ type: "element", tagName: "ac:parameter", properties: { "ac:name": "maxLevel" }, children: [{ type: "text", value: String(maxLevel) }] }],
  };
}

/* ────────────── main plugin ────────────── */

export default function rehypeConfluenceStorage(opts: RehypeConfluenceOptions = {}) {
  const insertToc = opts.insertToc !== false;
  const tocMacroId = opts.tocMacroId ?? "a854a720-dea6-4d0f-a0a2-e4591c07d85e";
  const tocMaxLevel = Number.isFinite(opts.tocMaxLevel) ? Number(opts.tocMaxLevel) : 3;
  const tocPosition: "top" | "after-first-h1" = opts.tocPosition ?? "top";

  return (tree: HRoot) => {
    const state = { foundToc: false };

    function stripTaskClasses(el: HNode) {
      const props = el.properties || (el.properties = {});
      const tokens = getClassList(props);
      const kept = tokens.filter(t => t !== "contains-task-list" && t !== "task-list-item");
      setClassList(props, kept);
    }

    const handlers: Record<string, (el: HNode, parent: HNode, idx: number) => void> = {
      "code-block": (el) => { rewriteCodeBlockCdata(el); },

      input: (el, parent, idx) => {
        const props = el.properties || {};
        if (props.type === "checkbox") {
          const checked = (("checked" in props && props.checked !== false) || props["aria-checked"] === "true");
          parent.children!.splice(idx, 1, { type: "text", value: checked ? "[x]" : "[ ]" });
        }
      },

      ul: stripTaskClasses,
      li: stripTaskClasses,

      "confluence-image": (el, parent, idx) => {
        const p = el.properties || {};
        const filename = String(p.filename ?? "").trim();
        if (!filename) return;
        let ac = makeAcImageFromSrc(filename, p.width, p.height, undefined, p.alt);
        const consumed = consumeAttrBlocksFromFollowingText(parent, idx);
        if (consumed.consumed) {
          const q = ac.properties || {};
          if (consumed.w) q["ac:width"] = consumed.w;
          if (consumed.h) q["ac:height"] = consumed.h;
          if (consumed.w || consumed.h) q["ac:thumbnail"] = "true";
          ac.properties = q;
        }
        parent.children!.splice(idx, 1, ac);
      },

      img: (el, parent, idx) => {
        const p = el.properties || {};
        const src = p.src ?? "";
        if (!src) return;

        // Writerside: any <img> with border-effect → @@ATTACH
        if (Object.prototype.hasOwnProperty.call(p, "border-effect")) {
          parent.children!.splice(idx, 1, convertImgToAttachToken(p));
          return;
        }

        // Normal HTML/MD image → <ac:image>
        let ac = makeAcImageFromSrc(String(src), p.width, p.height, p.style, p.alt);
        const consumed = consumeAttrBlocksFromFollowingText(parent, idx);
        if (consumed.consumed) {
          const q = ac.properties || {};
          if (consumed.w) q["ac:width"] = consumed.w;
          if (consumed.h) q["ac:height"] = consumed.h;
          if (consumed.w || consumed.h) q["ac:thumbnail"] = "true";
          ac.properties = q;
        }
        parent.children!.splice(idx, 1, ac);
      },

      a: (el, parent, idx) => {
        if (el.children && el.children.length === 1) {
          const only = el.children[0]!;
          if (only.type === "element" && (only as any).tagName === "ac:image") {
            parent.children!.splice(idx, 1, only);
          }
        }
      },

      del: (el) => {
        const props = el.properties || {};
        el.tagName = "span";
        const style = String(props.style || "");
        el.properties = {
          ...props,
          style: style ? (style.includes("text-decoration") ? style : `${style};text-decoration:line-through;`)
                       : "text-decoration:line-through;",
        };
      },
    };

    function visit(node: HNode, parent: HNode | null, idx: number | null, inPre: boolean) {
      if (!node || node.type !== "element") return;
      const el = node;
      const tag = (el.tagName || "").toLowerCase();
      const props = el.properties || (el.properties = {});
      const nextInPre = inPre || tag === "pre" || tag === "code";

      if (!state.foundToc && hasTocMacro(el)) state.foundToc = true;

      // Skip transforming <img> inside <pre>/<code>
      if ((tag === "img") && nextInPre) {
        // still normalize props below
      } else {
        const handler = handlers[tag];
        if (handler) handler(el, parent as HNode, idx as number);
      }

      // Recurse
      if (Array.isArray(el.children)) {
        for (let i = 0; i < el.children.length; i++) {
          visit(el.children[i] as HNode, el, i, nextInPre);
        }
      }

      // Normalize/self-close after children
      if (HTML_VOID.has(tag)) { el.children = []; el.selfClosing = true; }
      if (el.properties) {
        const p = el.properties;
        for (const key of Object.keys(p)) {
          if (key === "className" || key === "class") continue;
          const val = p[key];
          if (val === true || val === "") p[key] = key;
          else if (val == null) delete p[key];
          else if (Array.isArray(val)) p[key] = val.join(" ");
        }
      }
    }

    /* FIX: traverse *root children* (not the root node itself) */
    if (Array.isArray(tree.children)) {
      for (let i = 0; i < tree.children.length; i++) {
        visit(tree.children[i] as HNode, tree, i, /*inPre*/ false);
      }
    }

    // Wrap top-level ac:image in <p>
    const newRootChildren: HNode[] = [];
    for (const child of tree.children || []) {
      if (child && child.type === "element" &&
          (child.tagName === "ac:image" || child.tagName === "confluence-image")) {
        newRootChildren.push({ type: "element", tagName: "p", properties: {}, children: [child] });
      } else {
        newRootChildren.push(child);
      }
    }

    // TOC injection
    let wrappedChildren: HNode[] = [];
    const shouldAddToc = insertToc && !state.foundToc;
    const tocMacro = shouldAddToc ? buildTocMacro(tocMacroId, tocMaxLevel) : null;
    if (tocMacro && tocPosition === "after-first-h1") {
      let inserted = false;
      for (const c of newRootChildren) {
        wrappedChildren.push(c);
        if (!inserted && c.type === "element" && c.tagName === "h1") {
          wrappedChildren.push(tocMacro); inserted = true;
        }
      }
      if (!inserted) wrappedChildren = [tocMacro, ...wrappedChildren];
    } else if (tocMacro) {
      wrappedChildren = [tocMacro, ...newRootChildren];
    } else {
      wrappedChildren = newRootChildren;
    }

    tree.children = [{
      type: "element",
      tagName: "div",
      properties: {
        "xmlns:ac": "http://atlassian.com/content",
        "xmlns:ri": "http://atlassian.com/resource/identifier",
      },
      children: wrappedChildren,
    }];
  };
}
