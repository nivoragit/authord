// Deno + npm interop, HAST v3
import type { Root, Element, Text, Properties, Content } from "hast";
import * as path from "node:path";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import process from "node:process";

import { renderMermaidDefinitionToFile } from "../utils/mermaid.ts";
import { IMAGE_DIR, hashString, isPngFileOK } from "../utils/images.ts";

/* ------------------------------ Options -------------------------------- */
export interface RehypeConfluenceMediaOptions {
  onMermaid?: (args: { code: string; index: number }) =>
    | { filename: string; alt?: string; width?: number | string; height?: number | string }
    | Promise<{ filename: string; alt?: string; width?: number | string; height?: number | string }>;
  renderMermaid?: boolean;                 // default true
  emitMode?: "hast" | "html";             // default "hast"
  htmlImgToAttach?: boolean;              // default false (topics usually not raw HTML)
  imagesDir?: string;                     // default IMAGE_DIR
}

/* ----------------------------- Utilities ------------------------------- */
function escapeAttr(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
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
function dimsFromProps(props?: Properties): { width?: string; height?: string; alt?: string } {
  const out: { width?: string; height?: string; alt?: string } = {};
  if (!props) return out;
  if (props.width != null) out.width = normalizeSizePx(props.width as any);
  if (props.height != null) out.height = normalizeSizePx(props.height as any);

  // Parse inline style e.g. "width:120px; height:80px"
  const style = (props.style ?? "") as string;
  if (typeof style === "string" && style) {
    const w = /(?:^|;)\s*width\s*:\s*(\d+)px\b/i.exec(style)?.[1];
    const h = /(?:^|;)\s*height\s*:\s*(\d+)px\b/i.exec(style)?.[1];
    if (!out.width && w) out.width = w;
    if (!out.height && h) out.height = h;
  }

  if (props.alt != null) out.alt = String(props.alt);
  return out;
}
function confluenceImageElement(filename: string, meta?: { alt?: string; width?: string; height?: string }): Element {
  const props: Properties = { filename };
  if (meta?.alt) props.alt = meta.alt;
  if (meta?.width) props.width = meta.width;
  if (meta?.height) props.height = meta.height;
  return { type: "element", tagName: "confluence-image", properties: props, children: [] };
}
function rawNodeOfConfluenceImage(filename: string, meta?: { alt?: string; width?: string; height?: string }): Content {
  return {
    type: "raw",
    value:
      `<confluence-image filename="${escapeAttr(filename)}"` +
      (meta?.alt ? ` alt="${escapeAttr(meta.alt)}"` : "") +
      (meta?.width ? ` width="${escapeAttr(meta.width)}"` : "") +
      (meta?.height ? ` height="${escapeAttr(meta.height)}"` : "") +
      ` />`,
  } as Content;
}
function attachStub(file: string, width?: string, height?: string): Content {
  let s = `@@ATTACH|file=${file}`;
  if (width) s += `|width=${width}`;
  if (height) s += `|height=${height}`;
  s += "@@";
  return { type: "text", value: s } as Content;
}

export default function rehypeConfluenceMedia(options: RehypeConfluenceMediaOptions = {}) {
  const {
    renderMermaid = true,
    emitMode = "hast",
    htmlImgToAttach = false,
    imagesDir = IMAGE_DIR,
  } = options;

  return async function transformer(tree: Root) {
    type Parent = Root | Element;
    type MermaidJob = { parent: Parent; index: number; codeText: string; order: number };

    const mermaidJobs: MermaidJob[] = [];
    let mermaidIndex = 0;

    const extractMermaidText = (node: Element): string => {
      const text = (node.children ?? [])
        .filter((c): c is Text => c.type === "text" && typeof c.value === "string")
        .map((c) => c.value)
        .join("\n")
        .trim();
      return text;
    };

    const walk = (node: Root | Content, parent: Parent | null, index: number | null) => {
      if (!node || typeof node !== "object") return;

      if (node.type === "root") {
        const kids = (node.children ?? []) as Content[];
        for (let i = 0; i < kids.length; i++) walk(kids[i]!, node, i);
        return;
      }

      if (node.type === "raw") {
        if (!htmlImgToAttach || !parent || typeof index !== "number") return;
        const val = String((node as any).value ?? "");
        if (!/<img\b/i.test(val)) return;

        // Very lightweight extraction (mirrors remark version behavior)
        const m = /<img\b([^>]*?)\/?>/i.exec(val);
        if (!m) return;
        const attrs = m[1] ?? "";
        const pick = (name: string) => {
          const r = new RegExp(`(?:\\s|^)${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(attrs);
          return r ? (r[2] ?? r[3] ?? r[4] ?? "").trim() : "";
        };
        const src = pick("src");
        if (!src) return;

        const width = normalizeSizePx(pick("width"));
        const height = normalizeSizePx(pick("height"));
        const file = basenameOf(src);

        (parent.children as Content[])[index] = attachStub(file, width, height);
        return;
      }

      if (node.type !== "element") return;
      const el = node;
      const tag = String(el.tagName || "");

      // 1) Mermaid: <code-block lang="mermaid">...</code-block> → <confluence-image .../>
      if (tag === "code-block") {
        if (renderMermaid && String(el.properties?.lang).toLowerCase() === "mermaid" && parent && typeof index === "number") {
          const codeText = extractMermaidText(el);
          if (codeText) mermaidJobs.push({ parent, index, codeText, order: ++mermaidIndex });
        }
        return; // Skip descending into code-blocks
      }

      // 2) <img src="..."> → <confluence-image filename="..."/>
      if (tag === "img" && parent && typeof index === "number") {
        if (!el.properties) return;
        const src = String(el.properties.src ?? "");
        if (!src) return;

        const file = basenameOf(src);
        const meta = dimsFromProps(el.properties);

        if (emitMode === "html") {
          (parent.children as Content[])[index] = rawNodeOfConfluenceImage(file, meta);
        } else {
          (parent.children as Content[])[index] = confluenceImageElement(file, meta);
        }
        return;
      }

      // Recurse
      const kids = (el.children ?? []) as Content[];
      for (let i = 0; i < kids.length; i++) walk(kids[i]!, el, i);
    };

    walk(tree, null, null);

    if (mermaidJobs.length === 0) return;

    const results = await Promise.all(mermaidJobs.map(async (job) => {
      let fileName: string | null = null;
      let metaWidth: string | undefined;
      let metaHeight: string | undefined;
      let metaAlt: string | undefined;

      if (options.onMermaid) {
        const res = await options.onMermaid({ code: job.codeText, index: job.order });
        fileName = basenameOf(res.filename);
        metaWidth = normalizeSizePx(res.width ?? undefined);
        metaHeight = normalizeSizePx(res.height ?? undefined);
        if (res.alt) metaAlt = String(res.alt);
      }

      if (!fileName) {
        const out = path.join(imagesDir, `${hashString("mermaid::" + job.codeText)}.png`);
        let ok = false;
        try {
          ok = fs.existsSync(out) ? await (isPngFileOK as any)(out) : false;
        } catch {
          ok = false;
        }

        if (!ok) {
          try {
            await renderMermaidDefinitionToFile(job.codeText, out, {
              width: process.env.MMD_WIDTH ? Number(process.env.MMD_WIDTH) : undefined,
              height: process.env.MMD_HEIGHT ? Number(process.env.MMD_HEIGHT) : undefined,
              scale: process.env.MMD_SCALE ? Number(process.env.MMD_SCALE) : undefined,
              backgroundColor: process.env.MMD_BG,
              theme: process.env.MMD_THEME,
              configFile: process.env.MMD_CONFIG,
            } as Record<string, unknown>);
            ok = await (isPngFileOK as any)(out);
            if (!ok) throw new Error("bad png");
          } catch {
            try { if (fs.existsSync(out)) await fsp.unlink(out); } catch {}
          }
        }

        if (ok) fileName = path.basename(out);
      }

      if (!fileName) return null;

      const meta = { alt: metaAlt, width: metaWidth, height: metaHeight };
      const content = (emitMode === "html")
        ? rawNodeOfConfluenceImage(fileName, meta)
        : confluenceImageElement(fileName, meta);
      return { parent: job.parent, index: job.index, content };
    }));

    for (const res of results) {
      if (!res) continue;
      (res.parent.children as Content[])[res.index] = res.content;
    }
  };
}
