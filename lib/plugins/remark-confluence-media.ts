// lib/plugins/remark-confluence-media.ts
// Deno + mdast v4 compatible
// - RAW HTML <img> → @@ATTACH stubs (test expectation)
// - Mermaid renders only if imagesDir exists; otherwise leave code block as-is
// - Markdown images → confluence-image (HAST) with robust {width/height} parsing
// - Single pass, async batching

import type {
  Root as MdRoot,
  Code,
  Image as MdImage,
  Paragraph,
  Html,
  RootContent,
  PhrasingContent,
} from "mdast";
import type { Parent as UnistParent, Node as UnistNode } from "npm:@types/unist@^3";

import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import process from "node:process";

import { renderMermaidDefinitionToFile } from "../utils/mermaid.ts";
import { IMAGE_DIR, hashString, isPngFileOK } from "../utils/images.ts";

/** Node introduced by mdast-util-directive */
interface TextDirective extends UnistNode {
  type: "textDirective";
  name?: string;
  attributes?: Record<string, unknown>;
  children?: PhrasingContent[];
}

type WithHData = UnistNode & {
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
  };
};
type NodeWithChildren = UnistNode & { children?: UnistNode[] };

/* ----------------------------- Type guards ----------------------------- */
function isParagraph(n: UnistNode): n is Paragraph { return !!n && (n as any).type === "paragraph"; }
function isImage(n: UnistNode): n is MdImage { return !!n && (n as any).type === "image"; }
function isText(n: UnistNode): n is PhrasingContent & { type: "text"; value: string } { return !!n && (n as any).type === "text"; }
function isCode(n: UnistNode): n is Code { return !!n && (n as any).type === "code"; }
function isHtml(n: UnistNode): n is Html { return !!n && (n as any).type === "html"; }
function isTextDirective(n: UnistNode): n is TextDirective { return !!n && (n as any).type === "textDirective"; }

/* ----------------------------- Utilities ------------------------------- */
function escapeAttr(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function basenameOf(url?: string): string {
  if (!url) return "";
  const base = url.split(/[?#]/)[0]!;
  return path.basename(base);
}
function normalizeSizePx(v?: string | number): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "number") return String(v);
  const s = String(v).trim().toLowerCase();
  const m = s.match(/^(\d+)(px)?$/);
  return m ? m[1] : undefined;
}
function parseAttrBlock(text: string): Record<string, string> | null {
  const t = text.trim();
  const m = t.match(/^\{([^}]*)\}$/);
  if (!m) return null;
  const inner = m[1].trim();
  if (!inner) return {};
  const entries = inner.split(/[,\s;]+/).map((kv) => kv.trim()).filter(Boolean);
  const map: Record<string, string> = {};
  for (const kv of entries) {
    const mm = kv.match(/^([^:=]+)\s*[:=]\s*(.+)$/);
    if (!mm) continue;
    const key = mm[1].trim().toLowerCase();
    const val = mm[2].trim();
    map[key] = val;
  }
  return map;
}

/** Extract one or more consecutive leading "{...}" groups from a string. */
function extractLeadingAttrBlocks(text: string): { blocks: string[]; consumed: number } | null {
  if (!text || text[0] !== "{") return null; // strict adjacency
  const blocks: string[] = [];
  let i = 0;
  while (i < text.length && text[i] === "{") {
    let depth = 0;
    const start = i;
    while (i < text.length) {
      const ch = text[i++];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) break;
    blocks.push(text.slice(start, i));
    while (i < text.length && /\s/.test(text[i])) i++; // gap between groups
  }
  return blocks.length ? { blocks, consumed: i } : null;
}

/** Collect a fragmented `{...}` attribute block across sibling nodes. */
function collectAttrBlockFromSiblings(
  siblings: Array<PhrasingContent | TextDirective>,
  startIndex: number,
): { raw: string; removeFrom: number; removeTo: number } | null {
  let buf = "";
  let started = false;
  let depth = 0;
  const from = startIndex;
  let to = startIndex - 1;

  const pieceOf = (n: PhrasingContent | TextDirective): string | null => {
    if (isText(n)) return n.value ?? "";
    if (isTextDirective(n)) {
      const name = (n.name ?? "").toString();
      const childText = (n.children ?? [])
        .map((c) => (isText(c) ? (c.value ?? "") : ""))
        .join("");
      return ":" + name + childText;
    }
    return null;
  };

  for (let j = startIndex; j < siblings.length; j++) {
    const p = pieceOf(siblings[j]!);
    if (p == null) {
      if (started) break;
      return null;
    }
    if (!started) {
      if (p.length === 0 || p[0] !== "{") return null; // strict adjacency
      started = true;
    }
    buf += p;
    for (let k = 0; k < p.length; k++) {
      const ch = p[k]!;
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    to = j;
    if (started && depth <= 0) break;
  }

  const trimmed = buf.trim();
  if (!started || depth !== 0) return null;
  if (!/^\{[^]*\}$/.test(trimmed)) return null;

  return { raw: trimmed, removeFrom: from, removeTo: to };
}

/** Build a Paragraph(Image) with correct child typing */
function paragraphOfImage(img: MdImage): Paragraph {
  return { type: "paragraph", children: [img as unknown as PhrasingContent] };
}

/** HAST custom element */
function toConfluenceImageHast(img: MdImage, filename: string, alt?: string, width?: string, height?: string): void {
  const n = img as WithHData;
  n.data ??= {};
  n.data.hName = "confluence-image";
  const props: Record<string, unknown> = { filename };
  if (alt) props.alt = alt;
  if (width) props.width = width;
  if (height) props.height = height;
  n.data.hProperties = props;
}

/** @@ATTACH stub */
function attachStub(file: string, width?: string, height?: string): string {
  let s = `@@ATTACH|file=${file}`;
  if (width) s += `|width=${width}`;
  if (height) s += `|height=${height}`;
  s += "@@";
  return s;
}

/** Convert raw HTML <img ...> into @@ATTACH stubs (used by tests). */
function htmlImgToAttachStubs(s: string): string {
  return s.replace(/<img\b([^>]*?)\/?>/gi, (full, attrs) => {
    const A = String(attrs);

    const pick = (name: string) => {
      const m = new RegExp(
        `(?:\\s|^)${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`,
        "i",
      ).exec(A);
      return m ? (m[2] ?? m[3] ?? m[4] ?? "").trim() : "";
    };

    const src = pick("src");
    if (!src) return full; // keep as-is if no src

    const wRaw = pick("width");
    const hRaw = pick("height");
    const width = normalizeSizePx(wRaw);
    const height = normalizeSizePx(hRaw);
    const file = basenameOf(src);

    return attachStub(file, width, height);
  });
}

/* ------------------------------ Options -------------------------------- */
export interface RemarkConfluenceMediaOptions {
  onMermaid?: (args: { code: string; index: number }) =>
    | { filename: string; alt?: string; width?: number | string; height?: number | string }
    | Promise<{ filename: string; alt?: string; width?: number | string; height?: number | string }>;

  /** Render mermaid to PNG automatically when possible. Default: true. */
  renderMermaid?: boolean;

  /** Emit for Markdown images: HAST custom element or raw HTML stub. Default: "hast". */
  emitMode?: "hast" | "html";

  /** Transform RAW HTML <img> nodes into @@ATTACH stubs. Default: true. */
  htmlImgToAttach?: boolean;

  /** Output directory for mermaid images. */
  imagesDir?: string;
}

/* ----------------------------- Transformer ----------------------------- */
export default function remarkConfluenceMedia(options: RemarkConfluenceMediaOptions = {}) {
  const {
    renderMermaid = true,
    emitMode = "hast",
    htmlImgToAttach = true,
    imagesDir = IMAGE_DIR,
  } = options;

  // IMPORTANT: only render Mermaid if the directory ALREADY EXISTS.
  // Tests expect code blocks to remain when images dir is missing.
  const IMAGES_DIR_EXISTS = (() => {
    try { return fs.existsSync(imagesDir); } catch { return false; }
  })();

  return async function transformer(tree: MdRoot) {
    const tasks: Promise<void>[] = [];
    let mermaidIndex = 0;

    const setDimsFromHintMap = (widthVal?: string | number, heightVal?: string | number) => {
      const width = normalizeSizePx(widthVal);
      const height = normalizeSizePx(heightVal);
      const out: { width?: string; height?: string } = {};
      if (width) out.width = width;
      if (height) out.height = height;
      return out;
    };

    const applyDimsFromSiblings = (parent: Paragraph, idx: number) => {
      const kids = (parent.children ?? []) as Array<PhrasingContent | TextDirective>;
      if (idx + 1 >= kids.length) return {};
      const next = kids[idx + 1]!;

      let width: string | undefined;
      let height: string | undefined;

      const collected = collectAttrBlockFromSiblings(kids, idx + 1);
      if (collected) {
        const attrs = parseAttrBlock(collected.raw);
        if (attrs) {
          width = normalizeSizePx(attrs["width"]);
          height = normalizeSizePx(attrs["height"]);
          const removeCount = collected.removeTo - collected.removeFrom + 1;
          kids.splice(collected.removeFrom, removeCount);
        }
      } else if (isText(next)) {
        const v = next.value ?? "";
        const lead = extractLeadingAttrBlocks(v);
        if (lead) {
          for (const raw of lead.blocks) {
            const a = parseAttrBlock(raw);
            if (a) {
              const w = normalizeSizePx(a["width"]);
              const h = normalizeSizePx(a["height"]);
              if (w) width = w;
              if (h) height = h;
            }
          }
          const remainder = v.slice(lead.consumed);
          if (remainder.length === 0) kids.splice(idx + 1, 1);
          else next.value = remainder;
        } else {
          const attrs = parseAttrBlock(v);
          if (attrs && v[0] === "{") {
            width = normalizeSizePx(attrs["width"]);
            height = normalizeSizePx(attrs["height"]);
            kids.splice(idx + 1, 1);
          }
        }
      }
      const dims: { width?: string; height?: string } = {};
      if (width) dims.width = width;
      if (height) dims.height = height;
      return dims;
    };

    const replaceWithConfluenceForMermaid = (
      parent: UnistParent,
      index: number,
      file: string,
      meta?: { alt?: string; width?: string; height?: string },
    ) => {
      if (emitMode === "html") {
        const htmlNode: Html = { type: "html", value: `<confluence-image filename="${escapeAttr(file)}"${meta?.alt ? ` alt="${escapeAttr(meta.alt)}"` : ""}${meta?.width ? ` width="${escapeAttr(meta.width)}"` : ""}${meta?.height ? ` height="${escapeAttr(meta.height)}"` : ""} />` };
        (parent.children as RootContent[])[index] = htmlNode as unknown as RootContent;
      } else {
        const img: MdImage = { type: "image", url: file, alt: meta?.alt ?? "" };
        toConfluenceImageHast(img, file, meta?.alt, meta?.width, meta?.height);
        (parent.children as RootContent[])[index] = paragraphOfImage(img) as unknown as RootContent;
      }
    };

    function walk(node: UnistNode, parent?: UnistParent, index?: number) {
      if (!node) return;

      // Mermaid: only render if directory exists
      if (isCode(node) && (node.lang || "").toLowerCase() === "mermaid" && parent && typeof index === "number") {
        if (!(renderMermaid && IMAGES_DIR_EXISTS)) return; // leave code block as-is

        const code = (node.value || "").trim();
        mermaidIndex += 1;

        tasks.push((async () => {
          let fileName: string | null = null;
          let metaWidth: string | undefined;
          let metaHeight: string | undefined;
          let metaAlt: string | undefined;

          if (options.onMermaid) {
            const res = await options.onMermaid({ code, index: mermaidIndex });
            fileName = basenameOf(res.filename);
            const dims = setDimsFromHintMap(res.width, res.height);
            metaWidth = dims.width;
            metaHeight = dims.height;
            if (res.alt) metaAlt = res.alt;
          }

          if (!fileName) {
            const out = path.join(options.imagesDir ?? imagesDir, `${hashString("mermaid::" + code)}.png`);
            let ok = false;
            if (fs.existsSync(out)) {
              ok = await (isPngFileOK as (p: string) => boolean | Promise<boolean>)(out);
            }
            if (ok) {
              fileName = path.basename(out);
            } else {
              try {
                await renderMermaidDefinitionToFile(code, out, {
                  width: process.env.MMD_WIDTH ? Number(process.env.MMD_WIDTH) : undefined,
                  height: process.env.MMD_HEIGHT ? Number(process.env.MMD_HEIGHT) : undefined,
                  scale: process.env.MMD_SCALE ? Number(process.env.MMD_SCALE) : undefined,
                  backgroundColor: process.env.MMD_BG,
                  theme: process.env.MMD_THEME,
                  configFile: process.env.MMD_CONFIG,
                } as Record<string, unknown>);
                const good = await (isPngFileOK as (p: string) => boolean | Promise<boolean>)(out);
                if (!good) throw new Error("bad png");
                fileName = path.basename(out);
              } catch {
                try { if (fs.existsSync(out)) await fsp.unlink(out); } catch { /* ignore */ }
                fileName = null;
              }
            }
          }

          if (fileName) {
            replaceWithConfluenceForMermaid(parent, index, fileName, {
              alt: metaAlt, width: metaWidth, height: metaHeight,
            });
          }
        })());
        return;
      }

      // Markdown images → confluence-image + parse {width/height} hints
      if (isParagraph(node)) {
        const para = node as Paragraph;
        const kids = para.children as PhrasingContent[];
        for (let i = 0; i < kids.length; i++) {
          const child = kids[i] as unknown as UnistNode;
          if (!isImage(child)) continue;

          const dims = applyDimsFromSiblings(para, i);
          const filename = basenameOf((child as MdImage).url);
          const alt = (child as MdImage).alt ?? undefined;

          // Always keep Markdown images as Confluence HAST (your downstream plugin emits <ac:image>)
          toConfluenceImageHast(child as MdImage, filename, alt, dims.width, dims.height);
        }
      }

      // RAW HTML: convert <img> → @@ATTACH|...@@ (tests expect this)
      if (isHtml(node) && htmlImgToAttach) {
        const val = (node as Html).value;
        if (typeof val === "string" && /<img\b/i.test(val)) {
          (node as Html).value = htmlImgToAttachStubs(val);
        }
      }

      // Recurse
      const p = node as NodeWithChildren;
      if (Array.isArray(p.children)) {
        for (let i = 0; i < p.children.length; i++) {
          walk(p.children[i]!, p as unknown as UnistParent, i);
        }
      }
    }

    walk(tree as unknown as UnistNode);
    await Promise.all(tasks);
  };
}
