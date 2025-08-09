/**********************************************************************
 * publish-single.ts — Library-style module (no argv parsing / no exit)
 * Flatten an Authord / Writerside project into one Confluence page
 * (Data Center / Server). Delta-aware + attachment healing.
 *********************************************************************/

import fs                from 'fs/promises';
import path              from 'path';
import { createHash }    from 'crypto';
import axios             from 'axios';

import {
  findPageWithVersion,   // returns PageHit | undefined  (no title)
  listAttachments,
  uploadImages,
  getRemoteProperty,
  setRemoteHash,
} from './utils/confluence-utils';
import { WritersideMarkdownTransformerDC } from '@authord/renderer';
import type { ConfluenceCfg } from './utils/types';

export interface PublishSingleOptions {
  md: string;
  images: string;
  baseUrl: string;
  token: string;
  space?: string;     // required only when creating (no pageId)
  pageId?: string;    // update this page directly if present
  title?: string;     // optional; when updating by id, keeps existing if omitted
}

/* ───────── helpers ───────── */
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

const readAllMd = async (dir: string) =>
  (await fs.readdir(dir))
    .filter(f => f.endsWith('.md'))
    .sort()
    .map(f => fs.readFile(path.join(dir, f), 'utf8'));

const extractFilenames = (xhtml: string): string[] => {
  const out: string[] = [];
  const re = /ri:filename="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xhtml))) out.push(m[1]);
  return out;
};

const auth = (cfg: ConfluenceCfg) => ({
  headers: { Authorization: `Bearer ${cfg.apiToken}` },
});

/** Fetch by pageId, but include title for “keep existing title” behavior. */
async function getPageWithVersion(cfg: ConfluenceCfg, pageId: string) {
  const url = `${cfg.baseUrl}/rest/api/content/${pageId}?expand=version,space`;
  const { data } = await axios.get(url, auth(cfg));
  return {
    id:          String(data.id),
    nextVersion: (data.version?.number ?? 0) + 1,
    title:       String(data.title ?? ''),
    spaceKey:    String(data.space?.key ?? ''),
  };
}

export async function publishSingle(options: PublishSingleOptions): Promise<void> {
  const cwd       = process.cwd();
  const mdDir     = path.resolve(cwd, options.md);
  const imgDir    = path.resolve(cwd, options.images);
  const baseUrl   = options.baseUrl || process.env.CONF_BASE_URL || '';
  const apiToken  = options.token    || process.env.CONF_TOKEN     || '';
  const pageIdArg = options.pageId;
  const titleArg  = options.title ?? 'Exported Documentation';
  const spaceKey  = options.space;

  for (const [label, val] of Object.entries({ mdDir, imgDir, baseUrl, apiToken })) {
    if (!val) throw new Error(`Missing required option: ${label}`);
  }
  if (!pageIdArg && !spaceKey) {
    throw new Error('Missing required option: space (only needed when page-id is absent)');
  }

  const cfg: ConfluenceCfg = { baseUrl, apiToken };

  // 1) Markdown → storage-XHTML + hash
  const mdRaw = (await Promise.all(await readAllMd(mdDir))).join('\n\n');
  const transformer = new WritersideMarkdownTransformerDC();
  const { value: storageHtml } = transformer.toStorage(mdRaw) as { value: string };
  const hash = sha256(Buffer.from(storageHtml));

  // 2) Resolve target + effectiveTitle WITHOUT reading hit.title on a union
  type MinimalHit = { id: string; nextVersion: number };
  let hit: MinimalHit | undefined;
  let effectiveTitle: string;

  if (pageIdArg) {
    // Updating a known page id → we can safely read its current title
    const page = await getPageWithVersion(cfg, pageIdArg);
    hit = { id: page.id, nextVersion: page.nextVersion };
    effectiveTitle = options.title ?? page.title; // keep current title if not provided
  } else {
    // Resolve (space, title). findPageWithVersion may return undefined.
    const found = await findPageWithVersion(cfg, spaceKey!, titleArg);
    hit = found ?? undefined;
    effectiveTitle = titleArg; // desired title for update/create
  }

  // 3) Delta check only when a page already exists
  if (hit) {
    const remoteHash = await getRemoteProperty(cfg, hit.id);
    if (remoteHash?.value === hash) {
      const need = extractFilenames(storageHtml);
      const have = await listAttachments(cfg, hit.id);
      const miss = need.filter(f => !have.has(f));
      if (!miss.length) {
        console.log('⏩ Nothing changed – skipping upload.');
        return;
      }
      console.log(`📸 Healing ${miss.length} missing attachment(s)…`);
      await Promise.all(miss.map(f => uploadImages(cfg, hit!.id, path.join(imgDir, f))));
      console.log('✅ Attachments healed – done.');
      return;
    }
  }

  // 4) Create or update body
  const body = { storage: { value: storageHtml, representation: 'storage' } };
  let pageId: string;

  if (hit) {
    await axios.put(
      `${cfg.baseUrl}/rest/api/content/${hit.id}`,
      { id: hit.id, type: 'page', title: effectiveTitle,
        version: { number: hit.nextVersion }, body },
      auth(cfg)
    );
    pageId = hit.id;
  } else {
    const { data } = await axios.post(
      `${cfg.baseUrl}/rest/api/content`,
      { type: 'page', title: effectiveTitle, space: { key: spaceKey }, body },
      auth(cfg)
    );
    pageId = String(data.id);
  }

  // 5) Sync attachments
  const need = extractFilenames(storageHtml);
  const have = await listAttachments(cfg, pageId);
  const miss = need.filter(f => !have.has(f));
  if (miss.length) {
    console.log(`📸 Uploading ${miss.length} attachment(s)…`);
    await Promise.all(miss.map(f => uploadImages(cfg, pageId, path.join(imgDir, f))));
  }

  // 6) Persist hash
  await setRemoteHash(cfg, pageId, hash);
  console.log(`✅ Published “${effectiveTitle}” (id ${pageId})`);
}
