import fs from 'fs';
import path from 'path';
import axios from 'axios';
import FormData from 'form-data';
import { v4 as uuidv4 } from 'uuid';

export interface ConfluenceCfg {
  baseUrl: string;
  email: string;
  apiToken: string;
}

export interface UploadResult {
  file: string;
  mediaId: string;
}

interface AttachmentVersion { number: number; }
interface ConfluenceAttachment {
  title: string;
  extensions?: { fileId: string };
  version: AttachmentVersion;
}
interface AttachmentResponse {
  results: ConfluenceAttachment[];
  size: number;
  _links?: { next?: string };
}

/**
 * Uploads an PNG. On duplicate-filename error, falls back to ensureAttachment.
 */
export async function uploadPng(
  cfg: ConfluenceCfg,
  pageId: string,
  pngPath: string
): Promise<UploadResult> {
  const fileName = path.basename(pngPath);
  const url = `${cfg.baseUrl}/wiki/rest/api/content/${pageId}/child/attachment`;
  const pngContent = await fs.promises.readFile(pngPath);

  const form = new FormData();
  form.append('file', pngContent, {
    filename: fileName,
    contentType: 'image/png+xml',
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
    // Detect duplicate-file error
    const isDuplicateError =
      axios.isAxiosError(err) &&
      err.response?.status === 400 &&
      typeof err.response.data.message === 'string' &&
      err.response.data.message.includes('same file name');
    if (isDuplicateError) {
      console.warn(`Attachment "${fileName}" already exists; fetching existing mediaId…`);
      return ensureAttachment(cfg, pageId, pngPath);
    }

    if (axios.isAxiosError(err)) {
      console.error('Upload failed with status:', err.response?.status);
      console.error('Response data:', err.response?.data);
    }
    throw new Error(`Failed to upload ${fileName}: ${err.message}`);
  }
}

/**
 * Finds an existing attachment’s fileId by iterating pages of results.
 */
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
    const searchUrl = `${cfg.baseUrl}/wiki/rest/api/content/${pageId}/child/attachment` +
      `?filename=${encodeURIComponent(fileName)}` +
      `&expand=extensions,version&start=${start}&limit=${limit}`;

    const resp = await axios.get<AttachmentResponse>(searchUrl, {
      auth: { username: cfg.email, password: cfg.apiToken }
    });

    for (const attachment of resp.data.results) {
      if (attachment.title === fileName &&
        attachment.extensions?.fileId &&
        attachment.version.number > latestVersion) {
        latestVersion = attachment.version.number;
        latestMediaId = attachment.extensions.fileId;
      }
    }

    const hasMore = resp.data.size >= limit && resp.data._links?.next;
    if (!hasMore) break;
    start += limit;
  }

  if (!latestMediaId) {
    throw new Error(`No existing attachment found for ${fileName}`);
  }
  return { file: fileName, mediaId: latestMediaId };
}

/**
 * Walks the ADF and replaces ATTACH-STUB placeholders with proper media nodes.
 * Ensures each media node has attrs.id, type, collection and occurrenceKey.
 */
export function injectMediaNodes(
  adf: any,
  map: Record<string, string>,
  pageId: string
): any {
  const walk = (node: any): any => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      if (
        node.type === 'paragraph' &&
        node.content?.length === 1 &&
        node.content[0].type === 'text' &&
        node.content[0].text.startsWith('ATTACH-STUB:')
      ) {
        const file = node.content[0].text.slice(12, -2); // node = ATTACH-STUB:xxxx.png@@, 'ATTACH-STUB:'.length = 12
        const mediaId = map[file];
        if (!mediaId) {
          console.warn(`⚠️  No mediaId found for file: "${file}"`);
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
            }
          }]
        };
      }
      if (node.content) node.content = walk(node.content);
    }
    return node;
  };
  return walk(adf);
}
