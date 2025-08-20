import axios from 'axios';
import fs from 'node:fs/promises';
import path from 'node:path';
import FormData from 'form-data';
import {
  AttachmentResponse,
  ConfluenceAttachment,
  ConfluenceCfg,
  PropertyData,
  UploadResult,
} from './types.ts';
import { Buffer } from "node:buffer";

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
