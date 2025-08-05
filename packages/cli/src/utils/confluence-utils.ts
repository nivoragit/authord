// packages/cli/src/utils/confluence-utils.ts
import axios from 'axios';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import sizeOf from 'image-size';
import { v4 as uuidv4 } from 'uuid';
import { AttachmentResponse, ConfluenceCfg, UploadResult } from './types';



/** Compute SHA-256 hash of a buffer */
export function sha256(b: Buffer): string {
  return createHash('sha256').update(b).digest('hex');
}

/** Check if a page exists in the given space */
export async function pageExists(
  cfg: ConfluenceCfg,
  pageId: string,
  space: string
): Promise<boolean> {
  try {
    const { data } = await axios.get(
      `${cfg.baseUrl}/wiki/rest/api/content/${pageId}?status=current&expand=space`,
      { auth: { username: cfg.email, password: cfg.apiToken } }
    );
    return data.type === 'page' && data.status === 'current' && data.space?.key === space;
  } catch {
    return false;
  }
}

/** Get the version number of a Confluence page */
export async function getPageVersion(
  cfg: ConfluenceCfg,
  id: string
): Promise<number> {
  const { data } = await axios.get(
    `${cfg.baseUrl}/wiki/rest/api/content/${id}?expand=version`,
    { auth: { username: cfg.email, password: cfg.apiToken } }
  );
  return data.version.number as number;
}

/** Returns the stored exportHash and its version number (if any) */
export async function getRemoteHash(
  cfg: ConfluenceCfg,
  pageId: string
): Promise<{ hash?: string; version?: number }> {
  try {
    const { data } = await axios.get<{
      value: string;
      version: { number: number };
    }>(
      `${cfg.baseUrl}/wiki/rest/api/content/${pageId}/property/exportHash`,
      { auth: { username: cfg.email, password: cfg.apiToken } }
    );
    return { hash: data.value, version: data.version.number };
  } catch (err: any) {
    if (axios.isAxiosError(err) && err.response?.status === 404) {
      // No property yet
      return {};
    }
    throw err;
  }
}

/** Sets (or updates) the exportHash property for a page */
export async function setRemoteHash(
  cfg: ConfluenceCfg,
  pageId: string,
  newHash: string
): Promise<void> {
  const { version } = await getRemoteHash(cfg, pageId);

  if (version != null) {
    // update existing property
    await axios.put(
      `${cfg.baseUrl}/wiki/rest/api/content/${pageId}/property/exportHash`,
      {
        key: 'exportHash',
        value: newHash,
        version: { number: version + 1 },
      },
      { auth: { username: cfg.email, password: cfg.apiToken } }
    );
  } else {
    // create it for the first time
    await axios.post(
      `${cfg.baseUrl}/wiki/rest/api/content/${pageId}/property`,
      { key: 'exportHash', value: newHash },
      { auth: { username: cfg.email, password: cfg.apiToken } }
    );
  }
}

/** List attachment titles on a page */
export async function listAttachments(
  cfg: ConfluenceCfg,
  pageId: string
): Promise<Set<string>> {
  let url = `${cfg.baseUrl}/wiki/rest/api/content/${pageId}/child/attachment?limit=200`;
  const names = new Set<string>();
  while (url) {
    const { data } = await axios.get(url, {
      auth: { username: cfg.email, password: cfg.apiToken }
    });
    (data.results ?? []).forEach((att: any) => names.add(att.title));
    url = data._links?.next ? cfg.baseUrl + data._links.next : '';
  }
  return names;
}

/** Find a page by title (and optional parent) in a space */
export async function findPageByTitle(
  cfg: ConfluenceCfg,
  space: string,
  title: string,
  parentId?: string
): Promise<string | undefined> {
  const url =
    `${cfg.baseUrl}/wiki/rest/api/content` +
    `?spaceKey=${encodeURIComponent(space)}` +
    `&title=${encodeURIComponent(title)}` +
    `&status=current&expand=ancestors`;
  const { data } = await axios.get(url, {
    auth: { username: cfg.email, password: cfg.apiToken }
  });
  const match = (data.results ?? []).find((r: any) =>
    r.type === 'page' &&
    (!parentId ||
      (Array.isArray(r.ancestors) &&
       r.ancestors.length &&
       r.ancestors[r.ancestors.length - 1].id === String(parentId)))
  );
  return match?.id;
}

/** Create a new page */
export async function createPage(
  cfg: ConfluenceCfg,
  space: string,
  title: string,
  adf: any,
  parent?: string
): Promise<string> {
  const url = `${cfg.baseUrl}/wiki/rest/api/content`;
  const payload: any = {
    type: 'page',
    title,
    space: { key: space },
    body: { atlas_doc_format: { value: JSON.stringify(adf), representation: 'atlas_doc_format' } },
  };
  if (parent) payload.ancestors = [{ id: parent }];
  const { data } = await axios.post(url, payload, {
    auth: { username: cfg.email, password: cfg.apiToken }
  });
  return data.id as string;
}

/** Update an existing page */
export async function updatePage(
  cfg: ConfluenceCfg,
  pageId: string,
  title: string,
  adf: any
): Promise<void> {
  const version = (await getPageVersion(cfg, pageId)) + 1;
  await axios.put(
    `${cfg.baseUrl}/wiki/rest/api/content/${pageId}`,
    {
      id: pageId,
      type: 'page',
      title,
      version: { number: version },
      body: { atlas_doc_format: { value: JSON.stringify(adf), representation: 'atlas_doc_format' } },
    },
    { auth: { username: cfg.email, password: cfg.apiToken } }
  );
}

/** Upsert (create or update) a page */
export async function upsertPage(
  cfg: ConfluenceCfg,
  space: string,
  title: string,
  adf: any,
  parentId?: string
): Promise<string> {
  const existing = await findPageByTitle(cfg, space, title, parentId);
  if (existing) {
    await updatePage(cfg, existing, title, adf);
    return existing;
  }
  return createPage(cfg, space, title, adf, parentId);
}

/** Uploads a PNG; on duplicate-filename falls back to ensureAttachment */
export async function uploadImages(
  cfg: ConfluenceCfg,
  pageId: string,
  cacheImagesPath: string
): Promise<UploadResult> {
  const fileName = path.basename(cacheImagesPath);
  const url = `${cfg.baseUrl}/wiki/rest/api/content/${pageId}/child/attachment`;
  const pngContent = await fs.promises.readFile(cacheImagesPath);

  const form = new FormData();
  form.append('file', pngContent, {
    filename: fileName,
    contentType: 'image/png',
    knownLength: pngContent.length,
  });

  try {
    const { data } = await axios.post(url, form, {
      headers: {
        ...form.getHeaders(),
        'X-Atlassian-Token': 'no-check',
        Authorization: `Basic ${Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString('base64')}`,
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    if (!data.results?.length) {
      throw new Error(`No results in upload response for ${fileName}`);
    }
    const mediaId = data.results[0].extensions?.fileId;
    if (!mediaId) {
      console.error('Upload response:', JSON.stringify(data, null, 2));
      throw new Error(`No fileId in upload response for ${fileName}`);
    }
    return { file: fileName, mediaId };

  } catch (err: any) {
    const isDuplicateError =
      axios.isAxiosError(err) &&
      err.response?.status === 400 &&
      typeof err.response.data.message === 'string' &&
      err.response.data.message.includes('same file name');
    if (isDuplicateError) {
      console.warn(`Attachment "${fileName}" already exists; fetching existing mediaId…`);
      return ensureAttachment(cfg, pageId, cacheImagesPath);
    }
    if (axios.isAxiosError(err)) {
      console.error('Upload failed with status:', err.response?.status);
      console.error('Response data:', err.response?.data);
    }
    throw new Error(`Failed to upload ${fileName}: ${err.message}`);
  }
}

/** Finds existing attachment’s fileId by paginating results */
export async function ensureAttachment(
  cfg: ConfluenceCfg,
  pageId: string,
  pngPath: string
): Promise<UploadResult> {
  const fileName = path.basename(pngPath);
  let latestMediaId: string | undefined;
  let latestVersion = -1;
  let start = 0;
  const limit = 100;

  while (true) {
    const searchUrl =
      `${cfg.baseUrl}/wiki/rest/api/content/${pageId}/child/attachment` +
      `?filename=${encodeURIComponent(fileName)}` +
      `&expand=extensions,version&start=${start}&limit=${limit}`;

    const resp = await axios.get<AttachmentResponse>(searchUrl, {
      auth: { username: cfg.email, password: cfg.apiToken }
    });

    for (const attachment of resp.data.results) {
      if (
        attachment.title === fileName &&
        attachment.extensions?.fileId &&
        attachment.version.number > latestVersion
      ) {
        latestVersion = attachment.version.number;
        latestMediaId = attachment.extensions.fileId;
      }
    }

    if (!(resp.data.size >= limit && resp.data._links?.next)) break;
    start += limit;
  }

  if (!latestMediaId) {
    throw new Error(`No existing attachment found for ${fileName}`);
  }
  return { file: fileName, mediaId: latestMediaId };
}

/** Builds a map from filename → mediaId, uploading or fetching as needed */
export async function buildPageMediaMap(
  cfg: ConfluenceCfg,
  pageId: string,
  imageDir: string,
  needed: Iterable<string>
): Promise<Record<string,string>> {
  const map: Record<string,string> = {};
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

/** Move a page under a new parent */
export async function movePage(
  cfg: ConfluenceCfg,
  pageId: string,
  newParent: string
): Promise<void> {
  const url = `${cfg.baseUrl}/wiki/rest/api/content/${pageId}/move/append?targetId=${newParent}`;
  await axios.post(url, null, {
    auth: { username: cfg.email, password: cfg.apiToken }
  });
}

/** Replace ATTACH-STUB placeholders with media nodes */
export function injectMediaNodes(
  adf: any,
  map: Record<string, string>,
  pageId: string,
  imageDir: string
): any {
  const walk = (node: any): any => {
    if (Array.isArray(node)) return node.map(walk).filter(Boolean);
    if (!node || typeof node !== 'object') return node;

    if (
      node.type === 'paragraph' &&
      node.content?.[0]?.type === 'text' &&
      node.content[0].text.startsWith('ATTACH-STUB:')
    ) {
      const raw = node.content[0].text.slice(12, -2);
      const [file, paramString = ''] = raw.split('|');
      const mediaId = map[file];
      if (!mediaId) console.warn(`No mediaId for ${file}`);

      const params = Object.fromEntries(
        paramString.split(';').map((p: string) => p.split('=').map(s => s.trim()))
      );
      const width = params.width ? Number(params.width) : undefined;
      let height: number | undefined;
      if (width) {
        try {
          const fullPath = path.join(imageDir, file);
          const buffer = fs.readFileSync(fullPath);
          const dims = sizeOf(buffer);
          if (dims.width && dims.height) {
            height = Math.round((dims.height / dims.width) * width);
          }
        } catch (e) {
          console.warn(`⚠️ Cannot determine dimensions for "${file}":`, e);
        }
      }

      return {
        type: 'mediaSingle',
        attrs: { layout: 'center' },
        content: [{
          type: 'media',
          attrs: {
            id: mediaId,
            type: 'file',
            collection: `contentId-${pageId}`,
            occurrenceKey: uuidv4(),
            ...(width !== undefined && { width }),
            ...(height !== undefined && { height }),
          }
        }]
      };
    }

    if (
      node.type === 'mediaSingle' &&
      node.content?.[0]?.type === 'media' &&
      node.content[0].attrs.type === 'external'
    ) {
      const media = node.content[0];
      const file = path.basename(media.attrs.url);
      const mediaId = map[file];
      if (!mediaId) console.warn(`No mediaId for ${file}`);
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

/** Collect referenced image filenames from ADF */
export function usedImagesInADF(adf: any): Set<string> {
  const found = new Set<string>();
  const walk = (n: any): void => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);

    if (
      n.type === 'paragraph' &&
      n.content?.[0]?.text?.startsWith('ATTACH-STUB:')
    ) {
      const raw = n.content[0].text.slice(12, -2);
      found.add(raw.split('|')[0]);
    }

    if (
      n.type === 'mediaSingle' &&
      n.content?.[0]?.attrs?.type === 'external'
    ) {
      found.add(path.basename(n.content[0].attrs.url));
    }

    if (n.content) walk(n.content);
  };
  walk(adf);
  return found;
}

