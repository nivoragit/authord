/**********************************************************************
 * utils/images.ts
 * Shared image helpers & globals
 *********************************************************************/

import { Buffer } from "node:buffer";
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as process from 'node:process';

export const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

export let IMAGE_DIR = process.env.AUTHORD_IMAGE_DIR ||
  path.resolve(process.cwd(), 'images');

export function setImageDir(dir: string) {
  IMAGE_DIR = dir;
}

/* ────────── hashing & PNG cache ────────── */
export const hashString = (s: string): string => {
  let h = 5381; for (let i = 0; i < s.length; i++) h = (h << 5) + h + s.charCodeAt(i);
  return Math.abs(h).toString(16);
};

export function isPngFileOK(p: string): boolean {
  try {
    const buf = fs.readFileSync(p);
    return buf.length >= 8 && buf.compare(PNG_MAGIC, 0, 8, 0, 8) === 0;
  } catch { return false; }
}
/* ────────── ATTACHMENT STUBS ────────── */
export const makeStub = (file: string, params = '') =>
  `@@ATTACH|file=${path.basename(file)}${params ? `|${params}` : ''}@@`;
