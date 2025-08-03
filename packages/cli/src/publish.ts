/**********************************************************************
 * Upload Writerside / Authord Markdown → Confluence (delta-aware)
 *  – If a page with the same **title + parent + space** already exists
 *    we now **update** that page instead of silently skipping it
 *  – Otherwise we **create** the page as before
 *********************************************************************/

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import axios from 'axios';
import { createHash } from 'crypto';
import readline from 'readline';
import minimist from 'minimist';
import { WritersideMarkdownTransformer } from '@authord/renderer-html';
import {
  ConfluenceCfg,
  injectMediaNodes,
  uploadImages,
  ensureAttachment,
  movePage,
  usedImagesInADF,
} from './utils/confluence-utils';
import {
  parseTreeConfig,
  flatten,
  parentKey,
  TreeNode,
} from './utils/toc-sync';

/* ──────────────── Local state (on-disk) ──────────────── */
interface StateEntry {
  pageId:       string;
  hash:         string;
  lastUploaded: string;
  parentId:     string;
  index:        number;
}
type State = Record<string, StateEntry>;
const STATE_FILE = path.resolve('.confluence-state.json');

/* ──────────────── Helpers ──────────────── */
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

async function loadState(): Promise<State> {
  try { return JSON.parse(await fs.readFile(STATE_FILE, 'utf8')) as State; }
  catch { return {}; }
}
async function saveState(s: State) {
  await fs.writeFile(STATE_FILE, JSON.stringify(s, null, 2));
}

const titleFromFilename = (fp: string) =>
  path.basename(fp, '.md')
      .replace(/[-_]/g, ' ')
      .split(' ')
      .map(w => w[0].toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');

const prompt = (q: string) =>
  new Promise<string>(res => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, a => { rl.close();  res(a.trim()); });
  });

/* ──────────────── Confluence helpers ──────────────── */
async function pageExists(cfg: ConfluenceCfg, pageId: string, space: string): Promise<boolean> {
  try {
    const { data } = await axios.get(
      `${cfg.baseUrl}/wiki/rest/api/content/${pageId}?status=current&expand=space`,
      { auth: { username: cfg.email, password: cfg.apiToken } }
    );
    return data.type === 'page' && data.status === 'current' && data.space?.key === space;
  } catch { return false; }
}

async function getPageVersion(cfg: ConfluenceCfg, id: string): Promise<number> {
  const { data } = await axios.get(
    `${cfg.baseUrl}/wiki/rest/api/content/${id}?expand=version`,
    { auth: { username: cfg.email, password: cfg.apiToken } }
  );
  return data.version.number as number;
}

/** Find an existing page by title (+optional parent) within a space. */
async function findPageByTitle(
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
    auth: { username: cfg.email, password: cfg.apiToken },
  });
  const match = (data.results ?? []).find((r: any) =>
    r.type === 'page' &&
    (!parentId ||
      (Array.isArray(r.ancestors) && r.ancestors.length &&
       r.ancestors[r.ancestors.length - 1].id === String(parentId)))
  );
  return match?.id;
}

async function createPage(
  cfg:   ConfluenceCfg,
  space: string,
  title: string,
  adf:   any,
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
    auth: { username: cfg.email, password: cfg.apiToken },
  });
  return data.id as string;
}

async function updatePage(
  cfg:    ConfluenceCfg,
  pageId: string,
  title:  string,
  adf:    any
) {
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
    { auth: { username: cfg.email, password: cfg.apiToken } },
  );
}

/** Upsert helper: update if exists, create otherwise, then return pageId. */
async function upsertPage(
  cfg:       ConfluenceCfg,
  space:     string,
  title:     string,
  adf:       any,
  parentId?: string
): Promise<string> {
  const existing = await findPageByTitle(cfg, space, title, parentId);
  if (existing) {
    await updatePage(cfg, existing, title, adf);
    return existing;
  }
  return createPage(cfg, space, title, adf, parentId);
}

/** Upload or retrieve all required images for a page and build a media map. */
async function buildPageMediaMap(
  cfg:      ConfluenceCfg,
  pageId:   string,
  imageDir: string,
  needed:   Iterable<string>
): Promise<Record<string,string>> {
  const map: Record<string,string> = {};
  for (const img of needed) {
    const abs = path.join(imageDir, img);
    let mediaId: string;
    try { ({ mediaId } = await ensureAttachment(cfg, pageId, abs)); }
    catch { ({ mediaId } = await uploadImages(cfg, pageId, abs)); }
    map[img] = mediaId;
  }
  return map;
}

/* ──────────────── Main ──────────────── */
async function main() {
  /* CLI parsing (unchanged) */
  const argv = minimist(process.argv.slice(2), {
    string: ['toc-dir', 'parent-root', 'toc', 'root-page'],
    alias: { d: 'toc-dir', p: 'parent-root' },
  });
  const [mdRoot, imagesDir, spaceKey] = argv._;
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

  /* Default missing props (migrations) */
  for (const e of Object.values(state) as Partial<StateEntry>[]) {
    if (!('parentId' in e)) e.parentId = parentRoot;
    if (!('index'    in e)) e.index    = 0;
  }

  if ((await prompt('Proceed with upload? (Y/n) ')).toLowerCase().startsWith('n')) {
    console.log('Aborted.');  return;
  }

  /* ── Process every .tree file ── */
  const allTocs = (await fs.readdir(tocDir)).filter(f => f.endsWith('.tree'));
  if (!allTocs.length) {
    console.error(`No .tree files in ${tocDir}`); process.exit(1);
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
      let adf     = transformer.toADF(raw);
      const used  = usedImagesInADF(adf);

      if (!rootEntry) {
        /* NEW state – but check Confluence first */
        const tmpPageId = await upsertPage(cfg, spaceKey, rootTitle, adf, parentRoot);
        const mediaMap  = await buildPageMediaMap(cfg, tmpPageId, cacheDir, used);
        adf             = injectMediaNodes(adf, mediaMap, tmpPageId, cacheDir);
        await updatePage(cfg, tmpPageId, rootTitle, adf);

        rootEntry = {
          pageId:       tmpPageId,
          hash:         hashRoot,
          lastUploaded: new Date().toISOString(),
          parentId:     parentRoot,
          index:        0,
        };
        state[rootMdPath] = rootEntry;
        console.log(`🆕 Root page "${rootTitle}" (${tmpPageId}) upserted`);
      } else if (rootEntry.hash !== hashRoot) {
        const mediaMap = await buildPageMediaMap(cfg, rootEntry.pageId, cacheDir, used);
        adf            = injectMediaNodes(adf, mediaMap, rootEntry.pageId, cacheDir);
        await updatePage(cfg, rootEntry.pageId, rootTitle, adf);

        rootEntry.hash = hashRoot;
        rootEntry.lastUploaded = new Date().toISOString();
        console.log(`🔄 Root page "${rootTitle}" updated`);
      }
    }

    /* ── Child pages ── */
    const ordered = flatten(nodes).filter(n => n.file !== startPage);
    for (const node of ordered) {
      const mdFile = path.join(mdRoot, node.file);
      try { await fs.access(mdFile); }
      catch { console.warn(`⚠️ Missing MD: ${node.file}; skipping.`); continue; }

      const buf      = await fs.readFile(mdFile);
      const hash     = sha256(buf);
      const prev     = state[mdFile];

      const parentTopic = parentKey(node);
      const parentPath  = parentTopic ? path.join(mdRoot, parentTopic) : '';
      const parentId    = parentTopic ? state[parentPath]?.pageId ?? rootEntry.pageId
                                      : rootEntry.pageId;

      /* if state points to a deleted page, drop it */
      const prevAlive   = prev && await pageExists(cfg, prev.pageId, spaceKey);
      const effective   = prevAlive ? prev : undefined;
      if (prev && !prevAlive) delete state[mdFile];

      const raw   = buf.toString('utf8');
      const title = raw.match(/^#\s+(.+)$/m)?.[1] || titleFromFilename(mdFile);
      let   adf   = transformer.toADF(raw);
      const used  = usedImagesInADF(adf);

      if (!effective) {
        /* new page in state – upsert instead of always-create */
        const pageId   = await upsertPage(cfg, spaceKey, title, adf, parentId);
        const mediaMap = await buildPageMediaMap(cfg, pageId, cacheDir, used);
        adf            = injectMediaNodes(adf, mediaMap, pageId, cacheDir);
        await updatePage(cfg, pageId, title, adf);

        state[mdFile] = {
          pageId,
          hash,
          lastUploaded: new Date().toISOString(),
          parentId,
          index: node.index,
        };
        console.log(`🆕 Upserted "${title}" (id ${pageId})`);
      } else {
        /* Existing page tracked in state */
        if (effective.parentId !== parentId || effective.index !== node.index) {
          await movePage(cfg, effective.pageId, parentId);
          effective.parentId = parentId;
          effective.index    = node.index;
          console.log(`🔀 Moved page ${effective.pageId}`);
        }
        if (effective.hash !== hash) {
          const mediaMap = await buildPageMediaMap(cfg, effective.pageId, cacheDir, used);
          adf            = injectMediaNodes(adf, mediaMap, effective.pageId, cacheDir);
          await updatePage(cfg, effective.pageId, title, adf);
          effective.hash         = hash;
          effective.lastUploaded = new Date().toISOString();
          console.log(`🔄 Updated "${title}"`);
        }
      }
    } /* end-for (node) */
  }   /* end-for (tocFile) */

  await saveState(state);
  console.log('\n✅ All trees synced.');
}

main().catch(err => { console.error('❌ Fatal:', err); process.exit(1); });
