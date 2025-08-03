#!/usr/bin/env ts-node
/**********************************************************************
 * publish-single.ts  –  Flatten a Writerside / Authord project into a
 *                       single Confluence page (create-or-update)
 *
 * Stateless: uses Confluence property "exportHash" for delta detection,
 * and re-injects attachments if any are manually deleted.
 *********************************************************************/

import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import minimist from 'minimist';
import { WritersideMarkdownTransformer } from '@authord/renderer-html';

import {
  ConfluenceCfg,
  findPageWithVersion,
  putPage,
  createPage,
  getRemoteProperty,
  setRemoteHash,
  listAttachments,
  buildMediaMap,
  usedImagesInADF,
  injectMediaNodes,
} from './utils/confluence-utils';

/* ─────────────────── tiny helpers ─────────────────── */
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const flatten = <T>(x: T[][]) => ([] as T[]).concat(...x);

/* ──────────────────────── MAIN ─────────────────────── */
async function main(): Promise<void> {
  const argv = minimist(process.argv.slice(2), { string: ['md','images','space','title'] });
  const mdDir     = argv.md     as string;
  const imgDir    = argv.images as string;
  const spaceKey  = argv.space  as string;
  const pageTitle = (argv.title as string) || 'Exported Documentation';

  if (!mdDir || !imgDir || !spaceKey) {
    console.error('Usage: ts-node publish-single.ts --md <dir> --images <dir> --space <SPACE> [--title "Page Title"]');
    process.exit(1);
  }

  const cfg: ConfluenceCfg = {
    baseUrl : process.env.CONF_BASE_URL!,
    email   : process.env.CONF_USER!,
    apiToken: process.env.CONF_TOKEN!,
  };
  if (!cfg.baseUrl || !cfg.email || !cfg.apiToken) {
    console.error('Missing CONF_BASE_URL / CONF_USER / CONF_TOKEN');
    process.exit(1);
  }

  // 1) Convert Markdown to ADF
  const mdFiles = (await fs.readdir(mdDir)).filter(f => f.endsWith('.md')).sort((a,b)=>a.localeCompare(b));
  const transformer = new WritersideMarkdownTransformer();
  const fragments = [] as any[];
  for (const file of mdFiles) {
    const raw = await fs.readFile(path.join(mdDir, file), 'utf8');
    fragments.push(transformer.toADF(raw).content);
  }
  const combinedContent = flatten(fragments);
  const doc = { type: 'doc', version: 1, content: combinedContent };
  const combinedHash = sha256(Buffer.from(JSON.stringify(doc)));

  // 2) Delta and missing-image detection
  const pageHit = await findPageWithVersion(cfg, spaceKey, pageTitle);
  if (pageHit) {
    const prop = await getRemoteProperty(cfg, pageHit.id);
    if (prop?.value === combinedHash) {
      const existing = await listAttachments(cfg, pageHit.id);
      const needed   = usedImagesInADF(doc);
      const missing  = [...needed].filter(img => !existing.has(img));
      if (missing.length === 0) {
        console.log('⏩ Nothing changed and all images present—skipping upload.');
        return;
      }
      console.log(`⚠️  Body unchanged but ${missing.length} image(s) missing:`, missing);
      const map = await buildMediaMap(cfg, pageHit.id, imgDir, needed);
      const finalDoc = injectMediaNodes(doc, map, pageHit.id, imgDir);
      const { nextVersion } = (await findPageWithVersion(cfg, spaceKey, pageTitle))!;
      await putPage(cfg, pageHit.id, pageTitle, finalDoc, nextVersion);
      await setRemoteHash(cfg, pageHit.id, combinedHash);
      console.log(`✅ Re-injected missing images on page ${pageHit.id}`);
      return;
    }
  }

  // 3) Create or update page body
  let pageId: string;
  if (pageHit) {
    await putPage(cfg, pageHit.id, pageTitle, doc, pageHit.nextVersion);
    pageId = pageHit.id;
  } else {
    pageId = await createPage(cfg, spaceKey, pageTitle, doc);
  }

  // 4) Full image injection
  const imagesNeeded = usedImagesInADF(doc);
  if (imagesNeeded.size > 0) {
    const map = await buildMediaMap(cfg, pageId, imgDir, imagesNeeded);
    const finalDoc = injectMediaNodes(doc, map, pageId, imgDir);
    const { nextVersion } = (await findPageWithVersion(cfg, spaceKey, pageTitle))!;
    await putPage(cfg, pageId, pageTitle, finalDoc, nextVersion);
  }

  // 5) Persist new hash
  await setRemoteHash(cfg, pageId, combinedHash);
  console.log(`✅ Exported all topics to "${pageTitle}" (id ${pageId})`);
}

main().catch(e => { console.error('❌ Fatal:', e); process.exit(1); });
