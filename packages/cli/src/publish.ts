#!/usr/bin/env ts-node
/* -------------------------------------------------------------------------
 * publish.ts – Confluence uploader with state‑tracking
 * -------------------------------------------------------------------------
 *  • One Markdown file → one Confluence page (create or update)
 *  • `.confluence-state.json` keeps { pageId, hash, lastUploaded }
 *  • Skips files whose SHA‑256 hash matches the stored one
 * ---------------------------------------------------------------------- */
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import axios from 'axios';
import { createHash } from 'crypto';
import readline from 'readline';
import { WritersideMarkdownTransformer } from '@authord/renderer-html';
import {
  ConfluenceCfg,
  injectMediaNodes,
  uploadImages
} from './utils/confluence-utils';

/* ── types & constants ───────────────────────────────────────────────── */
interface StateEntry {
  pageId: string;
  hash: string;
  lastUploaded: string;
}

type State = Record<string, StateEntry>;

const STATE_FILE = path.resolve('.confluence-state.json');

/* ── small helpers ───────────────────────────────────────────────────── */
function sha256(buf: Buffer) {
  return createHash('sha256').update(buf).digest('hex');
}

async function loadState(): Promise<State> {
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveState(state: State) {
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

function titleFromFilename(filePath: string): string {
  return path
    .basename(filePath, '.md')
    .replace(/[-_]/g, ' ')
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

async function birthtime(p: string) {
  try { const s = await fs.stat(p); return s.birthtime || s.mtime; }
  catch { return new Date(); }
}

function prompt(q: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(q, a => { rl.close(); res(a.trim()); }));
}

async function findPageByTitle(cfg: ConfluenceCfg, space: string, title: string): Promise<string | undefined> {
  try {
    const { data } = await axios.get(`${cfg.baseUrl}/wiki/rest/api/content`, {
      params: { spaceKey: space, title, limit: 1 },
      auth  : { username: cfg.email, password: cfg.apiToken }
    });
    return data.results?.[0]?.id;
  } catch {
    return undefined;
  }
}

async function getPageVersion(cfg: ConfluenceCfg, id: string): Promise<number> {
  const { data } = await axios.get(`${cfg.baseUrl}/wiki/rest/api/content/${id}?expand=version`, {
    auth: { username: cfg.email, password: cfg.apiToken }
  });
  return data.version.number as number;
}

async function createPage(cfg: ConfluenceCfg, space: string, title: string, adf: any, parentId?: string) {
  const payload: any = {
    type : 'page',
    title,
    space: { key: space },
    body : {
      atlas_doc_format: { value: JSON.stringify(adf), representation: 'atlas_doc_format' }
    }
  };
  if (parentId) payload.ancestors = [{ id: parentId }];
  const { data } = await axios.post(`${cfg.baseUrl}/wiki/rest/api/content`, payload, {
    auth: { username: cfg.email, password: cfg.apiToken }
  });
  return data.id as string;
}

async function updatePage(cfg: ConfluenceCfg, pageId: string, title: string, adf: any) {
  const nextVer = (await getPageVersion(cfg, pageId)) + 1;
  await axios.put(`${cfg.baseUrl}/wiki/rest/api/content/${pageId}`, {
    id: pageId,
    type: 'page',
    title,
    version: { number: nextVer },
    body: {
      atlas_doc_format: { value: JSON.stringify(adf), representation: 'atlas_doc_format' }
    }
  }, { auth: { username: cfg.email, password: cfg.apiToken } });
}

/* ── main flow ───────────────────────────────────────────────────────── */
(async () => {
  const [, , mdPathOrDir, imagesPath, spaceKey, parentId] = process.argv;
  if (!mdPathOrDir || !imagesPath || !spaceKey) {
    console.error('Usage: publish.ts <md-file|dir> <images-dir> <space-key> [parent-page-id]');
    process.exit(1);
  }

  /* credentials */
  const cfg: ConfluenceCfg = {
    baseUrl : process.env.CONF_BASE_URL!,
    email   : process.env.CONF_USER!,
    apiToken: process.env.CONF_TOKEN!
  };
  if (!cfg.baseUrl || !cfg.email || !cfg.apiToken) {
    console.error('Missing CONF_BASE_URL / CONF_USER / CONF_TOKEN');
    process.exit(1);
  }

  /* discover markdown files */
  const st = await fs.stat(mdPathOrDir);
  let mdFiles: string[] = [];
  if (st.isDirectory()) {
    const files = (await fs.readdir(mdPathOrDir))
      .filter(f => f.endsWith('.md'))
      .map(f => path.join(mdPathOrDir, f));
    const dated = await Promise.all(files.map(async f => ({ f, d: await birthtime(f) })));
    mdFiles = dated.sort((a, b) => a.d.getTime() - b.d.getTime()).map(x => x.f);
  } else {
    mdFiles = [mdPathOrDir];
  }
  if (!mdFiles.length) { console.error('No Markdown files found.'); process.exit(1); }
  console.log(`📑 ${mdFiles.length} Markdown file(s) detected.`);

  /* copy images to tmp dir */
  const cacheDir = path.join(os.tmpdir(), 'writerside-diagrams');
  await fs.mkdir(cacheDir, { recursive: true });
  try {
    for (const img of await fs.readdir(imagesPath)) {
      await fs.copyFile(path.join(imagesPath, img), path.join(cacheDir, img));
    }
  } catch {/* ignore */}

  if ((await prompt('Proceed with upload? (Y/n) ')).toLowerCase().startsWith('n')) process.exit(0);

  const transformer = new WritersideMarkdownTransformer();
  const state = await loadState();

  /* iterate files */
  for (const mdPath of mdFiles) {
    const buf  = await fs.readFile(mdPath);
    const hash = sha256(buf);
    const entry = state[mdPath];

    /* unchanged? */
    if (entry && entry.hash === hash) {
      console.log(`⏭️  Skip ${path.basename(mdPath)} – unchanged.`);
      continue;
    }

    /* determine title */
    const raw   = buf.toString('utf8');
    const h1    = raw.match(/^#\s+(.+)$/m)?.[1]?.trim();
    const title = h1 || titleFromFilename(mdPath);

    /* resolve pageId: from state ▸ Confluence search ▸ create */
    let pageId: string | undefined = entry?.pageId;
    if (!pageId) pageId = await findPageByTitle(cfg, spaceKey, title);

    let adf = transformer.toADF(raw);

    if (pageId) {
      await updatePage(cfg, pageId, title, adf);
      console.log(`🔄 Updated “${title}” (id ${pageId})`);
    } else {
      pageId = await createPage(cfg, spaceKey, title, adf, parentId);
      console.log(`🆕 Created “${title}” (id ${pageId})`);
    }

    /* attachments */
    const map: Record<string,string> = {};
    for (const png of await fs.readdir(cacheDir)) {
      const { file, mediaId } = await uploadImages(cfg, pageId, path.join(cacheDir, png));
      map[file] = mediaId;
    }
    if (Object.keys(map).length) {
      adf = injectMediaNodes(adf, map, pageId, cacheDir);
      await updatePage(cfg, pageId, title, adf);
    }

    /* update state */
    state[mdPath] = {
      pageId,
      hash,
      lastUploaded: new Date().toISOString()
    };
  }

  await saveState(state);
  console.log('✅ All done.');
})().catch(e => { console.error('❌ Fatal:', e); process.exit(1); });