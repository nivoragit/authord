// Shared image helpers (no network). Pure Deno FS + small utilities.

import * as path from "node:path";

/** PNG file signature (magic bytes) */
export const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Default image dir, overridable via AUTHORD_IMAGE_DIR env and setImageDir(). */
export let IMAGE_DIR: string = Deno.env.get("AUTHORD_IMAGE_DIR") ?? "images";

/** Update the global image directory (used by adapters/publishers). */
export function setImageDir(dir: string) {
  IMAGE_DIR = dir;
}

/** Simple deterministic hash (FNV-1a 32-bit) rendered as lowercase hex. */
export function hashString(input: string): string {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ("00000000" + h.toString(16)).slice(-8);
}

/** Check whether a file looks like a valid PNG by magic header. */
export async function isPngFileOK(filePath: string): Promise<boolean> {
  try {
    const f = await Deno.open(filePath, { read: true });
    try {
      const buf = new Uint8Array(8);
      const n = await f.read(buf);
      if (n !== 8) return false;
      for (let i = 0; i < 8; i++) {
        if (buf[i] !== PNG_MAGIC[i]) return false;
      }
      return true;
    } finally {
      f.close();
    }
  } catch {
    return false;
  }
}

function normalizeDim(v?: number | string): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "number") return String(v);
  const s = String(v).trim().toLowerCase();
  const m = s.match(/^(\d+)(px)?$/);
  return m ? m[1] : undefined;
}

/**
 * Create a minimal Confluence Storage image attachment stub.
 * Example output:
 *  <ac:image ac:width="100" ac:height="200"><ri:attachment ri:filename="pic.png"/></ac:image>
 */
export function makeAttachmentStub(
  file: string,
  params?: { width?: number | string; height?: number | string; alt?: string },
): string {
  const filename = path.basename(file);
  const width = normalizeDim(params?.width);
  const height = normalizeDim(params?.height);

  const attrs: string[] = [];
  if (width) attrs.push(`ac:width="${escapeAttr(width)}"`);
  if (height) attrs.push(`ac:height="${escapeAttr(height)}"`);

  const altAttr = params?.alt ? ` alt="${escapeAttr(params.alt)}"` : "";

  return `<ac:image${attrs.length ? " " + attrs.join(" ") : ""}${altAttr}><ri:attachment ri:filename="${escapeAttr(filename)}"/></ac:image>`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
