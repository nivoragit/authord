import fs from 'fs';
import path from 'path';
import axios from 'axios';
import FormData from 'form-data';
import sizeOf from 'image-size';
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
    contentType: 'image/png', // todo
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
      return ensureAttachment(cfg, pageId, cacheImagesPath);
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
  pageId: string,
  imageDir: string
): any {
  const walk = (node: any): any => {
    if (Array.isArray(node)) return node.map(walk).filter(Boolean);
    if (!node || typeof node !== 'object') return node;

    // Handle your ATTACH‐STUB case
    if (
      node.type === 'paragraph' &&
      node.content?.[0]?.type === 'text' &&
      node.content[0].text.startsWith('ATTACH-STUB:')
    ) {
      const raw = node.content[0].text.slice(12, -2);
      const [file, paramString = ''] = raw.split('|');
      const mediaId = map[file];
      if (!mediaId) console.warn(`No mediaId for ${file}`);

      // parse width from params
      const params = Object.fromEntries(
        paramString.split(';').map((p: string) => p.split('=').map((s: string) => s.trim()))
      );
      const width = params.width ? Number(params.width) : undefined;

      // compute height if width given
      let height: number | undefined;
      if (width) {
        try {
          // Read the image into a Buffer so sizeOf() accepts it
          const fullPath = path.join(imageDir, file);
          const buffer = fs.readFileSync(fullPath);
          const dims = sizeOf(buffer);
          if (dims.width && dims.height) {
            height = Math.round((dims.height / dims.width) * width);
          }
        } catch (e) {
          console.warn(`⚠️  Cannot determine dimensions for "${file}":`, e);
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

    // existing external→file logic...
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


// <img src="completion_procedure.png" alt="completion suggestions for procedure" border-effect="line"/> // not supported
