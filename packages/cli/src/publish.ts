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

interface StateEntry {
  pageId: string;
  hash: string;
  lastUploaded: string;
  parentId: string;
  index: number;
}
type State = Record<string, StateEntry>;

const STATE_FILE = path.resolve('.confluence-state.json');

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

async function loadState(): Promise<State> {
  try {
    return JSON.parse(await fs.readFile(STATE_FILE, 'utf8')) as State;
  } catch {
    return {};
  }
}

async function saveState(state: State): Promise<void> {
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

function titleFromFilename(fp: string): string {
  return path
    .basename(fp, '.md')
    .replace(/[-_]/g, ' ')
    .split(' ')
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function prompt(q: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(q, (a) => { rl.close(); res(a.trim()); }));
}

async function pageExists(cfg: ConfluenceCfg, pageId: string, space: string): Promise<boolean> {
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

async function getPageVersion(cfg: ConfluenceCfg, id: string): Promise<number> {
  const { data } = await axios.get(
    `${cfg.baseUrl}/wiki/rest/api/content/${id}?expand=version`,
    { auth: { username: cfg.email, password: cfg.apiToken } },
  );
  return data.version.number as number;
}

async function createPage(cfg: ConfluenceCfg, space: string, title: string, adf: any, parent?: string): Promise<string> {
  const url = `${cfg.baseUrl}/wiki/rest/api/content`;
  const authOpts = { auth: { username: cfg.email, password: cfg.apiToken } };
  const payload: any = {
    type: 'page',
    title,
    space: { key: space },
    body: {
      atlas_doc_format: {
        value: JSON.stringify(adf),
        representation: 'atlas_doc_format',
      },
    },
  };
  if (parent) payload.ancestors = [{ id: parent }];
  try {
    const { data } = await axios.post(url, payload, authOpts);
    return data.id as string;
  } catch (err: any) {
    if (axios.isAxiosError(err) && err.response?.status === 404 && payload.ancestors) {
      delete payload.ancestors;
      const { data: retry } = await axios.post(url, payload, authOpts);
      return retry.id as string;
    }
    throw err;
  }
}

async function updatePage(cfg: ConfluenceCfg, pageId: string, title: string, adf: any): Promise<void> {
  const nextVer = (await getPageVersion(cfg, pageId)) + 1;
  await axios.put(
    `${cfg.baseUrl}/wiki/rest/api/content/${pageId}`,
    {
      id: pageId,
      type: 'page',
      title,
      version: { number: nextVer },
      body: {
        atlas_doc_format: {
          value: JSON.stringify(adf),
          representation: 'atlas_doc_format',
        },
      },
    },
    { auth: { username: cfg.email, password: cfg.apiToken } },
  );
}

async function buildPageMediaMap(
  cfg: ConfluenceCfg,
  pageId: string,
  imageDir: string,
  needed: Iterable<string>
): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
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

async function main() {
  const argv = minimist(process.argv.slice(2), {
    string: ['toc-dir', 'parent-root', 'toc', 'root-page'],
    alias: { d: 'toc-dir', p: 'parent-root' },
  });

  const [mdRoot, imagesDir, spaceKey] = argv._;
  const tocDir = (argv['toc-dir'] ?? argv['toc']) as string;
  const parentRoot = (argv['parent-root'] ?? argv['root-page']) as string;

  if (!mdRoot || !imagesDir || !spaceKey || !tocDir || !parentRoot) {
    console.error('Usage: publish.ts <md-root> <images-dir> <space-key> --toc-dir <tree-folder> --parent-root <PARENT_ID>');
    process.exit(1);
  }

  const cfg: ConfluenceCfg = {
    baseUrl: process.env.CONF_BASE_URL!,
    email: process.env.CONF_USER!,
    apiToken: process.env.CONF_TOKEN!,
  };
  if (!cfg.baseUrl || !cfg.email || !cfg.apiToken) {
    console.error('Missing CONF_BASE_URL / CONF_USER / CONF_TOKEN');
    process.exit(1);
  }

  const cacheDir = path.join(os.tmpdir(), 'writerside-diagrams');
  await fs.mkdir(cacheDir, { recursive: true });
  for (const img of await fs.readdir(imagesDir)) {
    await fs.copyFile(path.join(imagesDir, img), path.join(cacheDir, img));
  }

  const transformer = new WritersideMarkdownTransformer();
  const state = await loadState();

  for (const [key, entry] of Object.entries(state)) {
    if (!(await pageExists(cfg, entry.pageId, spaceKey))) {
      console.warn(`↺ Page ${entry.pageId} vanished on Confluence – recreating.`);
      delete state[key];
    }
  }

  for (const e of Object.values(state) as Partial<StateEntry>[]) {
    if (!('parentId' in e)) e.parentId = parentRoot;
    if (!('index' in e)) e.index = 0;
  }

  if ((await prompt('Proceed with upload? (Y/n) ')).toLowerCase().startsWith('n')) {
    console.log('Aborted.');
    return;
  }

  const allTocs = (await fs.readdir(tocDir)).filter(f => f.endsWith('.tree'));
  if (!allTocs.length) {
    console.error(`No .tree files in ${tocDir}`);
    process.exit(1);
  }

  for (const tocFile of allTocs) {
    const treePath = path.join(tocDir, tocFile);
    const { rootTitle, startPage, nodes } = await parseTreeConfig(treePath);
    console.log(`\n📂 Syncing tree "${tocFile}", root="${rootTitle}"`);

    const rootMdPath = path.join(mdRoot, startPage);
    const bufRoot = await fs.readFile(rootMdPath);
    const hashRoot = sha256(bufRoot);
    let rootEntry = state[rootMdPath];

    if (!rootEntry) {
      const raw = bufRoot.toString('utf8');
      let adf = transformer.toADF(raw);
      const used = usedImagesInADF(adf);
      const pageId = await createPage(cfg, spaceKey, rootTitle, adf, parentRoot);
      const mediaMap = await buildPageMediaMap(cfg, pageId, cacheDir, used);
      adf = injectMediaNodes(adf, mediaMap, pageId, cacheDir);
      await updatePage(cfg, pageId, rootTitle, adf);
      rootEntry = { pageId, hash: hashRoot, lastUploaded: new Date().toISOString(), parentId: parentRoot, index: 0 };
      state[rootMdPath] = rootEntry;
    }

    const ordered = flatten(nodes).filter(n => n.file !== startPage);
    for (const node of ordered) {
      const mdFile = path.join(mdRoot, node.file);
      try { await fs.access(mdFile); } catch { console.warn(`⚠️ Missing MD: ${node.file}; skipping.`); continue; }
      const buf = await fs.readFile(mdFile);
      const hash = sha256(buf);
      const prev = state[mdFile];

      const parentTopic = parentKey(node);
      const parentPath = parentTopic ? path.join(mdRoot, parentTopic) : '';
      const parentId = prev && prev.parentId && !parentTopic ? prev.parentId : state[parentPath as keyof typeof state]?.pageId || rootEntry.pageId;

      const prevAlive = prev && (await pageExists(cfg, prev.pageId, spaceKey));
      const effectivePrev = prevAlive ? prev : undefined;
      if (prev && !prevAlive) delete state[mdFile];

      const raw = buf.toString('utf8');
      const title = raw.match(/^#\s+(.+)$/m)?.[1] || titleFromFilename(mdFile);
      let adf = transformer.toADF(raw);
      const used = usedImagesInADF(adf);

      if (!effectivePrev) {
        const pageId = await createPage(cfg, spaceKey, title, adf, parentId);
        const mediaMap = await buildPageMediaMap(cfg, pageId, cacheDir, used);
        adf = injectMediaNodes(adf, mediaMap, pageId, cacheDir);
        await updatePage(cfg, pageId, title, adf);
        state[mdFile] = { pageId, hash, lastUploaded: new Date().toISOString(), parentId, index: node.index };
        console.log(`🆕 Created "${title}" (id ${pageId})`);
      } else {
        if (effectivePrev.parentId !== parentId || effectivePrev.index !== node.index) {
          await movePage(cfg, effectivePrev.pageId, parentId);
          effectivePrev.parentId = parentId;
          effectivePrev.index = node.index;
          console.log(`🔀 Moved page ${effectivePrev.pageId}`);
        }
        if (effectivePrev.hash !== hash) {
          const mediaMap = await buildPageMediaMap(cfg, effectivePrev.pageId, cacheDir, used);
          adf = injectMediaNodes(adf, mediaMap, effectivePrev.pageId, cacheDir);
          await updatePage(cfg, effectivePrev.pageId, title, adf);
          effectivePrev.hash = hash;
          effectivePrev.lastUploaded = new Date().toISOString();
          console.log(`🔄 Updated "${title}"`);
        }
      }
    }
  }
  await saveState(state);
  console.log('\n✅ All trees synced.');
}

main().catch((e) => {
  console.error('❌ Fatal:', e);
  process.exit(1);
});
