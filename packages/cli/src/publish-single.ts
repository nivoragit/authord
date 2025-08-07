#!/usr/bin/env ts-node
/**********************************************************************
 * publish-single.ts  –  Flatten an Authord / Writerside project into
 * one Confluence page (Data Center / Server).  Delta-aware.
 *********************************************************************/

import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import minimist from 'minimist';
import axios from 'axios';

import {
  findPageWithVersion,
  listAttachments,
  uploadImages,
  getRemoteProperty,
  setRemoteHash,
} from './utils/confluence-utils';
import { WritersideMarkdownTransformerDC } from '@authord/renderer';
import type { ConfluenceCfg } from './utils/types';

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
  let m;
  while ((m = re.exec(xhtml))) out.push(m[1]);
  return out;
};

const auth = (cfg: ConfluenceCfg) => ({
  headers: { Authorization: `Bearer ${cfg.apiToken}` },
});

/* ───────── MAIN ───────── */
async function main() {
  const argv = minimist(process.argv.slice(2), {
    string: ['md', 'images', 'space', 'title', 'base-url', 'token'],
  });

  const cwd       = process.cwd();
  const mdDir     = path.resolve(cwd, argv.md     ?? 'topics');
  const imgDir    = path.resolve(cwd, argv.images ?? 'images');
  const spaceKey  = argv.space;
  const pageTitle = argv.title     ?? 'Exported Documentation';
  const baseUrl   = argv['base-url'] ?? process.env.CONF_BASE_URL;
  const apiToken  = argv.token      ?? process.env.CONF_TOKEN;

  for (const [k, v] of Object.entries({ mdDir, imgDir, spaceKey, baseUrl, apiToken }))
    if (!v) { console.error(`Missing required option: ${k}`); process.exit(1); }

  /* 0️⃣  Confluence credentials */
  const cfg: ConfluenceCfg = { baseUrl, apiToken };

  /* 1️⃣  Markdown → storage-XHTML */
  const mdRaw = (await Promise.all(await readAllMd(mdDir))).join('\n\n');
  const transformer = new WritersideMarkdownTransformerDC();
  const { value: storageHtml } = transformer.toStorage(mdRaw);
  const hash = sha256(Buffer.from(storageHtml));

  /* 2️⃣  Delta-check */
  const hit = await findPageWithVersion(cfg, spaceKey, pageTitle);
  if (hit && (await getRemoteProperty(cfg, hit.id))?.value === hash) {
    const need = extractFilenames(storageHtml);
    const have = await listAttachments(cfg, hit.id);
    const miss = need.filter(f => !have.has(f));
    if (!miss.length) { console.log('⏩ Nothing changed – skipping upload.'); return; }
    console.log(`📸 Healing ${miss.length} missing attachment(s)…`);
    await Promise.all(miss.map(f => uploadImages(cfg, hit.id, path.join(imgDir, f))));
    console.log('✅ Attachments healed – done.'); return;
  }

  /* 3️⃣  Create / update page */
  const body = { storage: { value: storageHtml, representation: 'storage' } };
  const pageId = hit
    ? (await axios.put(
        `${cfg.baseUrl}/rest/api/content/${hit.id}`,
        { id: hit.id, type: 'page', title: pageTitle,
          version: { number: hit.nextVersion }, body },
        auth(cfg)
      ), hit.id)
    : (await axios.post(
        `${cfg.baseUrl}/rest/api/content`,
        { type: 'page', title: pageTitle, space: { key: spaceKey }, body },
        auth(cfg)
      )).data.id as string;

  /* 4️⃣  Sync attachments */
  const need = extractFilenames(storageHtml);
  const have = await listAttachments(cfg, pageId);
  const miss = need.filter(f => !have.has(f));
  if (miss.length) {
    console.log(`📸 Uploading ${miss.length} attachment(s)…`);
    await Promise.all(miss.map(f => uploadImages(cfg, pageId, path.join(imgDir, f))));
  }

  /* 5️⃣  Store hash for next run */
  await setRemoteHash(cfg, pageId, hash);
  console.log(`✅ Published “${pageTitle}” (id ${pageId})`);
}

main().catch(err => { console.error('❌ Fatal:', err); process.exit(1); });
