/**********************************************************************
 * publish-single.ts  –  Flatten an entire Writerside / Authord project
 *                       into one Confluence page (upsert)
 *********************************************************************/

import fs from 'fs/promises';
import path from 'path';
import os  from 'os';
import axios from 'axios';
import { createHash } from 'crypto';
import minimist from 'minimist';
import { WritersideMarkdownTransformer } from '@authord/renderer-html';

import {
  ConfluenceCfg,
  injectMediaNodes,
  uploadImages,
  ensureAttachment,
  usedImagesInADF,
} from './utils/confluence-utils';

/* ─────────────────── tiny helpers ─────────────────── */
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const flatten = <T>(x: T[][]) => ([] as T[]).concat(...x);

/* ─────────── Confluence helpers reused from publish.ts ────────── */
async function findPageByTitle(cfg: ConfluenceCfg, space: string, title: string): Promise<string|undefined> {
  const url = `${cfg.baseUrl}/wiki/rest/api/content?spaceKey=${space}&title=${encodeURIComponent(title)}&status=current`;
  const { data } = await axios.get(url, { auth: { username: cfg.email, password: cfg.apiToken } });
  return data.results?.[0]?.id;
}
async function getVer(cfg: ConfluenceCfg, id: string) {
  const { data } = await axios.get(
    `${cfg.baseUrl}/wiki/rest/api/content/${id}?expand=version`,
    { auth: { username: cfg.email, password: cfg.apiToken } },
  );
  return data.version.number as number;
}
async function upsertPage(cfg: ConfluenceCfg, space: string, title: string, adf: any): Promise<string> {
  const existing = await findPageByTitle(cfg, space, title);
  if (existing) {
    await axios.put(
      `${cfg.baseUrl}/wiki/rest/api/content/${existing}`,
      {
        id: existing, title, type: 'page',
        version: { number: (await getVer(cfg, existing))+1 },
        body: { atlas_doc_format: { value: JSON.stringify(adf), representation: 'atlas_doc_format' } },
      },
      { auth: { username: cfg.email, password: cfg.apiToken } },
    );
    return existing;
  }
  const { data } = await axios.post(
    `${cfg.baseUrl}/wiki/rest/api/content`,
    {
      type: 'page',
      title,
      space: { key: space },
      body: { atlas_doc_format: { value: JSON.stringify(adf), representation: 'atlas_doc_format' } },
    },
    { auth: { username: cfg.email, password: cfg.apiToken } },
  );
  return data.id as string;
}
async function buildMediaMap(
  cfg: ConfluenceCfg,
  pageId: string,
  imgDir: string,
  needed: Iterable<string>,
): Promise<Record<string,string>> {
  const map: Record<string,string> = {};
  for (const img of needed) {
    const abs = path.join(imgDir, img);
    let mediaId: string;
    try { ({ mediaId } = await ensureAttachment(cfg, pageId, abs)); }
    catch { ({ mediaId } = await uploadImages(cfg, pageId, abs)); }
    map[img] = mediaId;
  }
  return map;
}

/* ──────────────────────── MAIN ─────────────────────── */
async function main() {
  const argv = minimist(process.argv.slice(2), {
    string: ['md', 'images', 'space', 'title'],
  });
  const mdDir    = argv.md     as string;   // root of markdown topics
  const imgDir   = argv.images as string;   // images/diagrams cache
  const spaceKey = argv.space  as string;
  const pageTitle = argv.title as string || 'Exported Documentation';

  if (!mdDir || !imgDir || !spaceKey) {
    console.error('Usage: npx ts-node publish-single.ts --md <dir> --images <dir> --space <SPACE> [--title "Page Title"]');
    process.exit(1);
  }

  const cfg: ConfluenceCfg = {
    baseUrl : process.env.CONF_BASE_URL!,
    email   : process.env.CONF_USER!,
    apiToken: process.env.CONF_TOKEN!,
  };
  if (!cfg.baseUrl || !cfg.email || !cfg.apiToken) {
    console.error('Missing CONF_BASE_URL / CONF_USER / CONF_TOKEN'); process.exit(1);
  }

  /* gather ALL .md files in deterministic order */
  const mdFiles = (await fs.readdir(mdDir))
                     .filter(f => f.endsWith('.md'))
                     .sort((a,b) => a.localeCompare(b));

  const transformer = new WritersideMarkdownTransformer();

  /* -------- 1) Convert every MD ⇒ ADF fragment -------- */
  const fragments = [];
  for (const file of mdFiles) {
    const raw = await fs.readFile(path.join(mdDir, file), 'utf8');
    fragments.push(transformer.toADF(raw).content); // only inner content, we’ll wrap later
  }
  const combinedContent = flatten(fragments);

  /* -------- 2) Build root ADF doc -------- */
  const doc = { type: 'doc', version: 1, content: combinedContent };

  /* -------- 3) Delta-detect by hashing -------- */
  const combinedHash = sha256(Buffer.from(JSON.stringify(doc)));
  const stateFile = path.join(os.tmpdir(), '.single-export.hash');  // simple state
  let prevHash = '';
  try { prevHash = await fs.readFile(stateFile, 'utf8'); } catch {/* ignore */}
  if (prevHash === combinedHash) {
    console.log('⏩  Nothing changed – skipping upload.'); return;
  }

  /* -------- 4) Create / update page (attachments afterwards) -------- */
  const pageId = await upsertPage(cfg, spaceKey, pageTitle, doc);

  /* -------- 5) Upload images & inject media nodes, then patch once -------- */
  const imagesNeeded = usedImagesInADF(doc);
  const map = await buildMediaMap(cfg, pageId, imgDir, imagesNeeded);
  const finalDoc = injectMediaNodes(doc, map, pageId, imgDir);
  await upsertPage(cfg, spaceKey, pageTitle, finalDoc);

  await fs.writeFile(stateFile, combinedHash);
  console.log(`✅  Exported all topics to "${pageTitle}" (id ${pageId})`);
}

main().catch(e => { console.error('❌ Fatal:', e); process.exit(1); });
