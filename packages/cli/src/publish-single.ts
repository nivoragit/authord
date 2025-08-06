#!/usr/bin/env ts-node
/**********************************************************************
 * publish-single.ts
 *
 * • Flattens a Writerside / Authord project into ONE Confluence page
 *   (Data Center / Server REST API, storage XHTML).
 * • Delta-aware: skips body + attachment work when nothing changed.
 *********************************************************************/

import fs             from 'fs/promises';
import path           from 'path';
import { createHash } from 'crypto';
import minimist       from 'minimist';
import axios          from 'axios';

import {
  ConfluenceCfg,
  findPageWithVersion,
  listAttachments,
  uploadImages,
  getRemoteProperty,
  setRemoteHash,
} from './utils/confluence-utils';
import { WritersideMarkdownTransformerDC } from '@authord/renderer-html';

/* ───────────────────────── helpers ───────────────────────── */
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

const readAllMd = async (dir: string) =>
  (await fs.readdir(dir))
    .filter(f => f.endsWith('.md'))
    .sort()
    .map(f => fs.readFile(path.join(dir, f), 'utf8'));

const extractFilenames = (xhtml: string): string[] => {
  const out: string[] = [];
  const re = /ri:filename="([^"]+)"/g;
  let m;
  while ((m = re.exec(xhtml))) out.push(m[1]);
  return out;
};

const auth = (cfg: ConfluenceCfg) => ({
  headers: { Authorization: `Bearer ${cfg.apiToken}` },
});

/* ───────────────────────── MAIN ───────────────────────── */
async function main() {
  const argv = minimist(process.argv.slice(2),
    { string: ['md', 'images', 'space', 'title'] });

  const mdDir     = argv.md;
  const imgDir    = argv.images;
  const spaceKey  = argv.space;
  const pageTitle = argv.title || 'Exported Documentation';

  if (!mdDir || !imgDir || !spaceKey) {
    console.error('Usage: --md <dir> --images <dir> --space <KEY> [--title "..."]');
    process.exit(1);
  }

  /* 0️⃣ Credentials */
  const cfg: ConfluenceCfg = {
    baseUrl : process.env.CONF_BASE_URL!,
    username: process.env.CONF_USERNAME!,
    apiToken: process.env.CONF_TOKEN!,
  };
  if (!cfg.baseUrl || !cfg.username || !cfg.apiToken) {
    console.error('CONF_BASE_URL / CONF_USERNAME / CONF_TOKEN env vars required.');
    process.exit(1);
  }

  /* 1️⃣ Markdown → storage-XHTML */
  const mdRaw      = (await Promise.all(await readAllMd(mdDir))).join('\n\n');
  const transformer = new WritersideMarkdownTransformerDC();
  const { value: storageHtml } = transformer.toStorage(mdRaw);
  const hash      = sha256(Buffer.from(storageHtml));

  /* 2️⃣ Page lookup & fast-path delta check */
  const hit = await findPageWithVersion(cfg, spaceKey, pageTitle);
  if (hit && (await getRemoteProperty(cfg, hit.id))?.value === hash) {
    const need = extractFilenames(storageHtml);
    console.log('🕵️ Detected attachments in body:', need);
    const have = await listAttachments(cfg, hit.id);
    const miss = need.filter(f => !have.has(f));
    console.log('📋 Attachments ready to upload (miss):', miss);
    if (!miss.length) {
      console.log('⏩ Nothing changed – skipping upload.');
      return;
    }
    console.log(`📸 Healing ${miss.length} missing attachment(s)…`);
    console.log('📋 Attachments ready to upload:', miss);
    await Promise.all(miss.map(f => uploadImages(cfg, hit.id, path.join(imgDir, f))));
    console.log('✅ Attachments healed – done.');
    return;
  }
  /* 3️⃣ Create or update the page body (so we own a valid pageId) */
  const body = { storage: { value: storageHtml, representation: 'storage' } };
  let pageId: string;

  if (hit) {
    await axios.put(
      `${cfg.baseUrl}/rest/api/content/${hit.id}`,
      { id: hit.id, type: 'page', title: pageTitle,
        version: { number: hit.nextVersion }, body },
      auth(cfg)
    );
    pageId = hit.id;
  } else {
    const { data } = await axios.post(
      `${cfg.baseUrl}/rest/api/content`,
      { type: 'page', title: pageTitle, space: { key: spaceKey }, body },
      auth(cfg)
    );
    pageId = data.id as string;
  }

  /* 4️⃣ Upload any images the body references */
  const need = extractFilenames(storageHtml);
  const have = await listAttachments(cfg, pageId);
  const miss = need.filter(f => !have.has(f));
  if (miss.length) {
    console.log('📋 Attachments ready to upload:', miss);
    console.log(`📸 Uploading ${miss.length} attachment(s)…`);
    await Promise.all(miss.map(f => uploadImages(cfg, pageId, path.join(imgDir, f))));
  }

  /* 5️⃣ Remember the new hash for next run */
  await setRemoteHash(cfg, pageId, hash);
  console.log(`✅ Published “${pageTitle}” (id ${pageId})`);
}

main().catch(err => {
  console.error('❌ Fatal:', err);
  process.exit(1);
});
