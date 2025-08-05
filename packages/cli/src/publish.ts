#!/usr/bin/env node
// packages/cli/src/publish.ts

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import readline from 'readline';
import minimist from 'minimist';
import { WritersideMarkdownTransformer } from '@authord/renderer-html';

import {
  sha256,
  pageExists,
  getRemoteHash,
  setRemoteHash,
  listAttachments,
  upsertPage,
  updatePage,
  buildPageMediaMap,
  movePage,
  injectMediaNodes,
  usedImagesInADF,
} from './utils/confluence-utils';
import {
  parseTreeConfig,
  flatten,
  parentKey
} from './utils/toc-sync';
import { ConfluenceCfg } from './utils/types';

/* ──────────────── Local state (on-disk) ──────────────── */
interface StateEntry {
  pageId:   string;
  parentId: string;
  index:    number;
}
type State = Record<string, StateEntry>;
const STATE_FILE = path.resolve('.confluence-state.json');

/* ──────────────── Helpers ──────────────── */
const prompt = (q: string): Promise<string> =>
  new Promise(res => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, answer => { rl.close(); res(answer.trim()); });
  });

const titleFromFilename = (fp: string): string =>
  path.basename(fp, '.md')
    .replace(/[-_]/g, ' ')
    .split(' ')
    .map(w => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');

/* ──────────────── Main ──────────────── */
async function main() {
  /* CLI parsing */
  const argv = minimist(process.argv.slice(2), {
    string: ['toc-dir', 'parent-root', 'toc', 'root-page'],
    alias: { d: 'toc-dir', p: 'parent-root' },
  });
  const [mdRoot, imagesDir, spaceKey] = argv._ as string[];
  const tocDir     = (argv['toc-dir']     ?? argv['toc'])      as string;
  const parentRoot = (argv['parent-root'] ?? argv['root-page']) as string;

  if (!mdRoot || !imagesDir || !spaceKey || !tocDir || !parentRoot) {
    console.error('Usage: publish.ts <md-root> <images-dir> <space-key> ' +
                  '--toc-dir <tree-folder> --parent-root <PARENT_ID>');
    process.exit(1);
  }

  /* Confluence creds */
  const cfg: ConfluenceCfg = {
    baseUrl:  process.env.CONF_BASE_URL!,
    email:    process.env.CONF_USER!,
    apiToken: process.env.CONF_TOKEN!,
  };
  if (!cfg.baseUrl || !cfg.email || !cfg.apiToken) {
    console.error('Missing CONF_BASE_URL / CONF_USER / CONF_TOKEN');
    process.exit(1);
  }

  /* Copy images to tmp (generation caches, etc.) */
  const cacheDir = path.join(os.tmpdir(), 'writerside-diagrams');
  await fs.mkdir(cacheDir, { recursive: true });
  for (const img of await fs.readdir(imagesDir)) {
    await fs.copyFile(path.join(imagesDir, img), path.join(cacheDir, img));
  }

  const transformer = new WritersideMarkdownTransformer();
  const state       = await loadState();

  /* Sanity-check recorded pages still exist */
  for (const [key, entry] of Object.entries(state)) {
    if (!(await pageExists(cfg, entry.pageId, spaceKey))) {
      console.warn(`↺ Page ${entry.pageId} vanished on Confluence – recreating state.`);
      delete state[key];
    }
  }

  /* ── Process every .tree file ── */
  const allTocs = (await fs.readdir(tocDir)).filter(f => f.endsWith('.tree'));
  if (!allTocs.length) {
    console.error(`No .tree files in ${tocDir}`);
    process.exit(1);
  }

  for (const tocFile of allTocs) {
    const treePath              = path.join(tocDir, tocFile);
    const { rootTitle, startPage, nodes } = await parseTreeConfig(treePath);
    console.log(`\n📂 Syncing tree "${tocFile}", root="${rootTitle}"`);

    /* ── Root page ── */
    const rootMdPath = path.join(mdRoot, startPage);
    const bufRoot    = await fs.readFile(rootMdPath);
    const hashRoot   = sha256(bufRoot);
    let   rootEntry  = state[rootMdPath];

    {
      const raw   = bufRoot.toString('utf8');
      let   adf   = transformer.toADF(raw);
      const used  = usedImagesInADF(adf);

      if (!rootEntry) {
        const tmpPageId  = await upsertPage(cfg, spaceKey, rootTitle, adf, parentRoot);
        const mediaMap   = await buildPageMediaMap(cfg, tmpPageId, cacheDir, used);
        adf              = injectMediaNodes(adf, mediaMap, tmpPageId, cacheDir);
        await updatePage(cfg, tmpPageId, rootTitle, adf);
        await setRemoteHash(cfg, tmpPageId, hashRoot);

        rootEntry = { pageId: tmpPageId, parentId: parentRoot, index: 0 };
        state[rootMdPath] = rootEntry;
        console.log(`🆕 Root page "${rootTitle}" (id ${tmpPageId}) upserted`);
      } else {
        const remoteHash  = await getRemoteHash(cfg, rootEntry.pageId);
        const attachments = await listAttachments(cfg, rootEntry.pageId);
        const missing     = [...used].filter(img => !attachments.has(img));

        if (remoteHash.hash === hashRoot && missing.length === 0) {
          console.log('⏩  Root unchanged – skipping.');
        } else {
          if (missing.length) {
            console.log(`⚠️  ${missing.length} attachment(s) missing on root:`, missing);
          }
          const mediaMap = await buildPageMediaMap(cfg, rootEntry.pageId, cacheDir, used);
          adf            = injectMediaNodes(adf, mediaMap, rootEntry.pageId, cacheDir);
          await updatePage(cfg, rootEntry.pageId, rootTitle, adf);
          await setRemoteHash(cfg, rootEntry.pageId, hashRoot);
          console.log(`🔄 Root page "${rootTitle}" updated`);
        }
      }
    }

    /* ── Child pages ── */
    const ordered = flatten(nodes).filter(n => n.file !== startPage);
    for (const node of ordered) {
      const mdFile = path.join(mdRoot, node.file);
      try {
        await fs.access(mdFile);
      } catch {
        console.warn(`⚠️ Missing MD: ${node.file}; skipping.`);
        continue;
      }

      const buf      = await fs.readFile(mdFile);
      const hash     = sha256(buf);
      const prev     = state[mdFile];

      const parentTopic = parentKey(node);
      const parentPath  = parentTopic ? path.join(mdRoot, parentTopic) : '';
      const parentId    = parentTopic
        ? (state[parentPath]?.pageId ?? state[rootMdPath].pageId)
        : state[rootMdPath].pageId;

      const prevAlive = prev && await pageExists(cfg, prev.pageId, spaceKey);
      if (prev && !prevAlive) delete state[mdFile];
      const effective = prevAlive ? prev : undefined;

      const raw   = buf.toString('utf8');
      const title = raw.match(/^#\s+(.+)$/m)?.[1] || titleFromFilename(mdFile);
      let   adf   = transformer.toADF(raw);
      const used  = usedImagesInADF(adf);

      if (!effective) {
        const pageId   = await upsertPage(cfg, spaceKey, title, adf, parentId);
        const mediaMap = await buildPageMediaMap(cfg, pageId, cacheDir, used);
        adf            = injectMediaNodes(adf, mediaMap, pageId, cacheDir);
        await updatePage(cfg, pageId, title, adf);
        await setRemoteHash(cfg, pageId, hash);

        state[mdFile] = { pageId, parentId, index: node.index };
        console.log(`🆕 Upserted "${title}" (id ${pageId})`);
      } else {
        if (effective.parentId !== parentId || effective.index !== node.index) {
          await movePage(cfg, effective.pageId, parentId);
          effective.parentId = parentId;
          effective.index    = node.index;
          console.log(`🔀 Moved page ${effective.pageId}`);
        }

        const remoteHash  = await getRemoteHash(cfg, effective.pageId);
        const attachments = await listAttachments(cfg, effective.pageId);
        const missing     = [...used].filter(img => !attachments.has(img));

        if (remoteHash.hash === hash && missing.length === 0) {
          console.log(`⏩  "${title}" unchanged – skipping.`);
        } else {
          if (missing.length) {
            console.log(`⚠️  ${missing.length} attachment(s) missing on "${title}":`, missing);
          }
          const mediaMap = await buildPageMediaMap(cfg, effective.pageId, cacheDir, used);
          adf            = injectMediaNodes(adf, mediaMap, effective.pageId, cacheDir);
          await updatePage(cfg, effective.pageId, title, adf);
          await setRemoteHash(cfg, effective.pageId, hash);
          console.log(`🔄 Updated "${title}"`);
        }
      }
    }
  }

  await saveState(state);
  console.log('\n✅ All trees synced.');
}

/* ──────────────── State I/O ──────────────── */
async function loadState(): Promise<State> {
  try { return JSON.parse(await fs.readFile(STATE_FILE, 'utf8')) as State; }
  catch { return {}; }
}
async function saveState(s: State) {
  await fs.writeFile(STATE_FILE, JSON.stringify(s, null, 2));
}

main().catch(err => { console.error('❌ Fatal:', err); process.exit(1); });
