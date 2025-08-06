/**********************************************************************
 * Confluence Data Center helpers
 * (upload pages, attachments, properties; inject media nodes, etc.)
 *********************************************************************/

import axios from 'axios';
import fs from 'fs/promises';
import { readFileSync } from 'fs';
import path from 'path';
import FormData from 'form-data';
import sizeOf from 'image-size';
import { v4 as uuidv4 } from 'uuid';

/* ════════════════ Config & helpers ════════════════ */
export interface ConfluenceCfg {
  baseUrl : string;  // https://confluence.mycorp.com
  username: string;  // Confluence DC username
  apiToken: string;  // Personal-Access-Token  (or password if you switch to basic auth)
}

export const authHeaders = (cfg: ConfluenceCfg) => ({
  headers: { Authorization: `Bearer ${cfg.apiToken}` },
});

/* ═══════════════ Types ═══════════════ */
export interface UploadResult { file: string; mediaId: string; }

interface AttachmentVersion   { number: number; }
interface ConfluenceAttachment {
  id: string;
  title: string;
  version: AttachmentVersion;
  _links?: { download?: string };
}
interface AttachmentResponse {
  results: ConfluenceAttachment[];
  size: number;
  _links?: { next?: string };
}

interface PageHit      { id: string; nextVersion: number; }
interface PropertyData { key: string; value: string; version: { number: number } }

/* ═════════════ Content CRUD & versioning ═════════════ */
export async function findPageWithVersion(
  cfg: ConfluenceCfg,
  spaceKey: string,
  title: string
): Promise<PageHit | undefined> {
  const { data } = await axios.get(
    `${cfg.baseUrl}/rest/api/content`,
    {
      ...authHeaders(cfg),
      params: { spaceKey, title, status: 'current', expand: 'version' },
    }
  );
  const hit = data.results?.[0];
  return hit
    ? { id: hit.id as string, nextVersion: (hit.version.number as number) + 1 }
    : undefined;
}

export async function createPage(
  cfg: ConfluenceCfg,
  spaceKey: string,
  title: string,
  adf: unknown
): Promise<string> {
  const { data } = await axios.post(
    `${cfg.baseUrl}/rest/api/content`,
    {
      type : 'page',
      title,
      space: { key: spaceKey },
      body : {
        atlas_doc_format: {
          value: JSON.stringify(adf),
          representation: 'atlas_doc_format',
        },
      },
    },
    authHeaders(cfg)
  );
  return data.id as string;
}

export async function putPage(
  cfg: ConfluenceCfg,
  pageId: string,
  title: string,
  adf: unknown,
  version: number
): Promise<void> {
  await axios.put(
    `${cfg.baseUrl}/rest/api/content/${pageId}`,
    {
      id: pageId,
      type: 'page',
      title,
      version: { number: version },
      body: {
        atlas_doc_format: {
          value: JSON.stringify(adf),
          representation: 'atlas_doc_format',
        },
      },
    },
    authHeaders(cfg)
  );
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
    if (axios.isAxiosError(err) && err.response?.status === 404) return undefined;
    throw err;
  }
}

export async function setRemoteHash(
  cfg: ConfluenceCfg,
  pageId: string,
  hash: string
): Promise<void> {
  const prop = await getRemoteProperty(cfg, pageId);
  if (prop) {
    await axios.put(
      `${cfg.baseUrl}/rest/api/content/${pageId}/property/exportHash`,
      { value: hash, version: { number: prop.version.number + 1 } },
      authHeaders(cfg)
    );
  } else {
    await axios.post(
      `${cfg.baseUrl}/rest/api/content/${pageId}/property`,
      { key: 'exportHash', value: hash },
      authHeaders(cfg)
    );
  }
}

/* ═════════════ Attachment helpers ═════════════ */
/* ─────────────────────────────────────────────────────────── */
/* listAttachments(): add retry-safe pagination guard         */
/* ─────────────────────────────────────────────────────────── */
export async function listAttachments(
  cfg: ConfluenceCfg,
  pageId: string
): Promise<Set<string>> {
  let url = `${cfg.baseUrl}/rest/api/content/${pageId}/child/attachment?limit=200`;
  const names = new Set<string>();

  while (url) {
    const { data } = await axios.get<AttachmentResponse>(url, authHeaders(cfg));
    data.results.forEach(a => names.add(a.title));
    url = data._links?.next ? cfg.baseUrl + data._links.next : '';
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

/* Upload a fresh image */
export async function uploadImages(
  cfg: ConfluenceCfg,
  pageId: string,
  absPng: string
): Promise<UploadResult> {
  const fileName = path.basename(absPng);
  const url      = `${cfg.baseUrl}/rest/api/content/${pageId}/child/attachment`;
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
      validateStatus  : s => s < 500,   // so we can inspect 4xx
    }
  );

  // Duplicate filename? => fallback
  if (!data.results?.length) {
    return ensureAttachment(cfg, pageId, absPng);
  }

  const att = data.results[0] as ConfluenceAttachment;
  return { file: fileName, mediaId: pickAttachmentId(att) };
}

/* Ensure (or discover) attachment, returning its ID */
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
  const url = `${cfg.baseUrl}/rest/api/content/${pageId}/move/append?targetId=${newParentId}`;
  await axios.post(url, null, authHeaders(cfg));
}

/* ═════════════ Media-node injection ═════════════ */
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
          const dims = sizeOf(buf);
          if (dims.width && dims.height) {
            height = Math.round((dims.height / dims.width) * width);
          }
        } catch { /* swallow dimension errors */ }
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

/* ═════════════ Util: find used images in ADF ═════════════ */
export function usedImagesInADF(adf: any): Set<string> {
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

/* ═════════════ Build (image → mediaId) map ═════════════ */
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
