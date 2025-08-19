/**********************************************************************
 * Confluence Data Center helpers
 * (all HTTP calls centralized here; robust try/catch + clear diagnostics)
 *********************************************************************/

import axios from 'axios';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import FormData from 'form-data';
import { imageSize } from 'image-size';
import { v4 as uuidv4 } from 'uuid';
import {
  AttachmentResponse,
  ConfluenceAttachment,
  ConfluenceCfg,
  PageHit,
  PropertyData,
  UploadResult,
} from './types.ts';
import { Buffer } from "node:buffer";

/* ───────────────────────── auth & diagnostics ───────────────────────── */

export const authHeaders = (cfg: ConfluenceCfg) => {
  const tok = (cfg.apiToken || '').trim();
  if (!tok) return { headers: {} };
  // If token looks like "user:token" → use Basic
  if (tok.includes(':')) {
    const basic = Buffer.from(tok, 'utf8').toString('base64');
    return { headers: { Authorization: `Basic ${basic}` } };
  }
  return { headers: { Authorization: `Bearer ${tok}` } };
};

function explainAxios(err: any): string {
  if (!axios.isAxiosError(err)) return String(err);
  const { status, statusText, data, config } = err.response || {};
  const method = (err.config?.method || 'GET').toUpperCase();
  const url    = err.config?.url || config?.url || '';
  let body: string;
  try { body = typeof data === 'string' ? data : JSON.stringify(data); }
  catch { body = '[unserializable error body]'; }
  return `[${method}] ${url} → HTTP ${status ?? '?'} ${statusText ?? ''} — ${body ?? ''}`;
}

/* ═════════════ Content CRUD & versioning ═════════════ */

export async function findPageWithVersion(
  cfg: ConfluenceCfg,
  spaceKey: string,
  title: string
): Promise<PageHit | undefined> {
  try {
    const { data } = await axios.get(
      `${cfg.baseUrl}/rest/api/content`,
      {
        ...authHeaders(cfg),
        params: { spaceKey, title, status: 'current', expand: 'version' },
      }
    );
    const hit = data.results?.[0];
    return hit
      ? { id: String(hit.id), nextVersion: Number(hit.version.number) + 1 }
      : undefined;
  } catch (err) {
    throw new Error(`findPageWithVersion failed: ${explainAxios(err)}`);
  }
}

/** Fetch by pageId, include title & space so callers can keep current title. */
export async function getPageWithVersion(cfg: ConfluenceCfg, pageId: string) {
  try {
    const url = `${cfg.baseUrl}/rest/api/content/${pageId}?expand=version,space`;
    const { data } = await axios.get(url, authHeaders(cfg));
    return {
      id:          String(data.id),
      nextVersion: (data.version?.number ?? 0) + 1,
      title:       String(data.title ?? ''),
      spaceKey:    String(data.space?.key ?? ''),
    };
  } catch (err) {
    throw new Error(`getPageWithVersion failed: ${explainAxios(err)}`);
  }
}

/** Create page with storage (XHTML) body — DC/Server style. */
export async function createPageStorage(
  cfg: ConfluenceCfg,
  spaceKey: string,
  title: string,
  storageHtml: string
): Promise<string> {
  try {
    const { data } = await axios.post(
      `${cfg.baseUrl}/rest/api/content`,
      {
        type : 'page',
        title,
        space: { key: spaceKey },
        body : { storage: { value: storageHtml, representation: 'storage' } },
      },
      authHeaders(cfg)
    );
    return String(data.id);
  } catch (err) {
    throw new Error(`createPageStorage failed: ${explainAxios(err)}`);
  }
}

/** Update page with storage (XHTML) body — requires next version number. */
export async function putPageStorage(
  cfg: ConfluenceCfg,
  pageId: string,
  title: string,
  nextVersion: number,
  storageHtml: string
): Promise<void> {
  try {
    await axios.put(
      `${cfg.baseUrl}/rest/api/content/${pageId}`,
      {
        id: pageId,
        type: 'page',
        title,
        version: { number: nextVersion },
        body: { storage: { value: storageHtml, representation: 'storage' } },
      },
      authHeaders(cfg)
    );
  } catch (err) {
    throw new Error(`putPageStorage failed: ${explainAxios(err)}`);
  }
}

/* ═════════════ Content-property management ═════════════ */

export async function getRemoteProperty(
  cfg: ConfluenceCfg,
  pageId: string
): Promise<PropertyData | undefined> {
  try {
    const { data } = await axios.get(
      `${cfg.baseUrl}/rest/api/content/${pageId}/property/exportHash`,
      authHeaders(cfg)
    );
    return data as PropertyData;
  } catch (err: any) {
    if (axios.isAxiosError(err)) {
      const code = err.response?.status;
      // Treat classic "not found" as undefined — and be lenient on some DC setups that 400 this endpoint
      if (code === 404) return undefined;
      if (code === 400) {
        // Some proxies/DC return 400 for unknown property keys — treat as missing to allow first publish
        return undefined;
      }
    }
    throw new Error(`getRemoteProperty failed: ${explainAxios(err)}`);
  }
}

export async function setRemoteHash(
  cfg: ConfluenceCfg,
  pageId: string,
  hash: string
): Promise<void> {
  try {
    const existing = await getRemoteProperty(cfg, pageId);
    if (existing) {
      await axios.put(
        `${cfg.baseUrl}/rest/api/content/${pageId}/property/exportHash`,
        { value: hash, version: { number: (existing.version?.number ?? 0) + 1 } },
        authHeaders(cfg)
      );
    } else {
      await axios.post(
        `${cfg.baseUrl}/rest/api/content/${pageId}/property`,
        { key: 'exportHash', value: hash },
        authHeaders(cfg)
      );
    }
  } catch (err) {
    throw new Error(`setRemoteHash failed: ${explainAxios(err)}`);
  }
}

/* ═════════════ Attachment helpers ═════════════ */

export async function listAttachments(
  cfg: ConfluenceCfg,
  pageId: string
): Promise<Set<string>> {
  const names = new Set<string>();
  let url = `${cfg.baseUrl}/rest/api/content/${pageId}/child/attachment?limit=200`;

  while (url) {
    try {
      const { data } = await axios.get<AttachmentResponse>(url, authHeaders(cfg));
      data.results.forEach(a => names.add(a.title));
      url = data._links?.next ? cfg.baseUrl + data._links.next : '';
    } catch (err) {
      throw new Error(`listAttachments failed: ${explainAxios(err)}`);
    }
  }
  return names;
}

/* helper – choose the correct identifier on DC */
function pickAttachmentId(att: ConfluenceAttachment): string {
  if (att.id) return att.id;

  const dl = att._links?.download;
  if (dl) {
    const m = dl.match(/[?&]fileId=([0-9a-f-]+)/i);
    if (m) return m[1];
  }
  throw new Error(`No usable ID for attachment "${att.title}"`);
}

/** Upload a fresh image (PNG) — falls back to ensureAttachment on filename conflicts (4xx). */
export async function uploadImages(
  cfg: ConfluenceCfg,
  pageId: string,
  absPng: string
): Promise<UploadResult> {
  const fileName = path.basename(absPng);
  const url      = `${cfg.baseUrl}/rest/api/content/${pageId}/child/attachment`;

  try {
    const pngBuf   = await fs.readFile(absPng);
    const form = new FormData();
    form.append('file', pngBuf, {
      filename: fileName,
      contentType: 'image/png',
      knownLength: pngBuf.length,
    });

    const { data } = await axios.post(
      url,
      form,
      {
        ...authHeaders(cfg),
        params: { expand: '_links' },
        headers: {
          ...form.getHeaders(),
          'X-Atlassian-Token': 'no-check',
          ...authHeaders(cfg).headers,
        },
        maxContentLength: Infinity,
        maxBodyLength   : Infinity,
        validateStatus  : s => s < 500,   // allow 4xx so we can fallback
      }
    );

    // Duplicate filename? => fallback to ensureAttachment
    if (!data.results?.length) {
      return ensureAttachment(cfg, pageId, absPng);
    }

    const att = data.results[0] as ConfluenceAttachment;
    return { file: fileName, mediaId: pickAttachmentId(att) };
  } catch (err) {
    // If direct upload failed for any reason, try to discover the latest mediaId
    try {
      return await ensureAttachment(cfg, pageId, absPng);
    } catch (fallbackErr) {
      throw new Error(`uploadImages failed: ${explainAxios(err)}; fallback failed: ${explainAxios(fallbackErr)}`);
    }
  }
}

/** Ensure (or discover) attachment, returning its mediaId. */
export async function ensureAttachment(
  cfg: ConfluenceCfg,
  pageId: string,
  absPng: string
): Promise<UploadResult> {
  const fileName = path.basename(absPng);
  let latestId   : string | undefined;
  let latestVer  = -1;
  let start      = 0;
  const limit    = 100;

  while (true) {
    try {
      const url =
        `${cfg.baseUrl}/rest/api/content/${pageId}/child/attachment` +
        `?filename=${encodeURIComponent(fileName)}` +
        `&expand=_links,version` +
        `&start=${start}&limit=${limit}`;

      const { data } = await axios.get<AttachmentResponse>(url, authHeaders(cfg));

      for (const att of data.results) {
        const id = pickAttachmentId(att);
        if (att.title === fileName && att.version.number > latestVer) {
          latestVer = att.version.number;
          latestId  = id;
        }
      }

      if (!(data.size >= limit && data._links?.next)) break;
      start += limit;
    } catch (err) {
      throw new Error(`ensureAttachment failed: ${explainAxios(err)}`);
    }
  }

  if (!latestId) throw new Error(`No existing attachment found for ${fileName}`);
  return { file: fileName, mediaId: latestId };
}

/* ═════════════ Page move ═════════════ */

export async function movePage(
  cfg: ConfluenceCfg,
  pageId: string,
  newParentId: string
): Promise<void> {
  try {
    const url = `${cfg.baseUrl}/rest/api/content/${pageId}/move/append?targetId=${newParentId}`;
    await axios.post(url, null, authHeaders(cfg));
  } catch (err) {
    throw new Error(`movePage failed: ${explainAxios(err)}`);
  }
}

/* ═════════════ Media-node injection (no HTTP) ═════════════ */

export function injectMediaNodes(
  adf: any,
  map: Record<string, string>,
  pageId: string,
  imageDir: string
): any {
  const walk = (node: any): any => {
    if (Array.isArray(node)) return node.map(walk).filter(Boolean);
    if (!node || typeof node !== 'object') return node;

    /* ATTACH-STUB → mediaSingle */
    if (
      node.type === 'paragraph' &&
      node.content?.[0]?.type === 'text' &&
      node.content[0].text.startsWith('ATTACH-STUB:')
    ) {
      const raw = node.content[0].text.slice(12, -2);
      const [file, paramStr = ''] = raw.split('|');

      const mediaId = map[file];
      const params  = Object.fromEntries(
        paramStr.split(';').map((p: string) => p.split('=').map((s: string) => s.trim())) as any
      );

      const width  = params.width ? Number(params.width) : undefined;
      let   height: number | undefined;

      if (width) {
        try {
          const buf  = readFileSync(path.join(imageDir, file));
          const dims = imageSize(buf);
          if (dims.width && dims.height) {
            height = Math.round((dims.height / dims.width) * width);
          }
        } catch { /* dimension lookup is best-effort */ }
      }

      return {
        type: 'mediaSingle',
        attrs: { layout: 'center' },
        content: [
          {
            type: 'media',
            attrs: {
              id: mediaId,
              type: 'file',
              collection: `contentId-${pageId}`,
              occurrenceKey: uuidv4(),
              ...(width  !== undefined && { width  }),
              ...(height !== undefined && { height }),
            },
          },
        ],
      };
    }

    /* external → internal rewrite */
    if (
      node.type === 'mediaSingle' &&
      node.content?.[0]?.type === 'media' &&
      node.content[0].attrs.type === 'external'
    ) {
      const media   = node.content[0];
      const file    = path.basename(media.attrs.url);
      const mediaId = map[file];
      media.attrs = {
        id: mediaId,
        type: 'file',
        collection: `contentId-${pageId}`,
        occurrenceKey: uuidv4(),
      };
    }

    if (node.content) node.content = walk(node.content);
    return node;
  };

  return walk(adf);
}

/* ═════════════ Build (image → mediaId) map (uses HTTP helpers) ═════════════ */

export async function usedImagesInADF(adf: any): Promise<Set<string>> {
  const found = new Set<string>();

  const walk = (n: any): void => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);

    if (n.type === 'paragraph' && n.content?.[0]?.text?.startsWith('ATTACH-STUB:')) {
      const raw = n.content[0].text.slice(12, -2);
      found.add(raw.split('|')[0]);
    }
    if (n.type === 'mediaSingle' && n.content?.[0]?.attrs?.type === 'external') {
      found.add(path.basename(n.content[0].attrs.url));
    }
    if (n.content) walk(n.content);
  };

  walk(adf);
  return found;
}

export async function buildMediaMap(
  cfg: ConfluenceCfg,
  pageId: string,
  imageDir: string,
  needed: Iterable<string>
): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  for (const img of needed) {
    const abs = path.join(imageDir, img);
    let mediaId: string;
    try {
      ({ mediaId } = await ensureAttachment(cfg, pageId, abs));
    } catch {
      ({ mediaId } = await uploadImages(cfg, pageId, abs));
    }
    map[img] = mediaId;
  }
  return map;
}
