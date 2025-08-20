/**********************************************************************
 * publish-single.ts — Library-style module (no argv parsing / no exit)
 * Flatten an Authord / Writerside project into one Confluence page
 * (Data Center / Server). Delta-aware + attachment healing.
 *
 * Ordering:
 * • Prefer Writerside .tree order from writerside.cfg (document order, DFS)
 * • Else, use Authord instances -> toc-elements (DFS)
 * • Else, alphabetical scan
 * • Always append orphan .md files (not in any tree) at the end
 *********************************************************************/

import fs                from 'node:fs/promises';
import fss               from 'node:fs';
import path              from 'node:path';
import { createHash }    from "node:crypto";
import { Buffer }        from "node:buffer";
import { XMLParser }     from 'fast-xml-parser';

import {
  listAttachments,
  uploadImages,
  getRemoteProperty,
  setRemoteHash,
  getPageWithVersion,                   // keep: to validate provided page-id & get nextVersion
  putPageStorage,
} from './utils/confluence-utils.ts';
import { setImageDir, WritersideMarkdownTransformerDC } from './writerside-markdown-transformer.ts';
import type { ConfluenceCfg, PublishSingleOptions } from './utils/types.ts';

/* ───────── helpers ───────── */
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

const normalize = <T>(x: T | T[] | undefined | null): T[] =>
  !x ? [] : Array.isArray(x) ? x : [x];

const fileExists = (p: string) => {
  try { return fss.existsSync(p); } catch { return false; }
};

async function readText(p: string): Promise<string> {
  return fs.readFile(p, 'utf8');
}

async function listAllMdFilesRecursive(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string) {
    const entries = await fs.readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) await walk(abs);
      else if (e.isFile() && e.name.endsWith('.md')) out.push(abs);
    }
  }
  if (fileExists(dir)) await walk(dir);
  // Sort by path for deterministic order when appended
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

/** Writerside: read topics in DFS document order from writerside.cfg → *.tree */
async function collectMdFromWriterside(rootDir: string, mdDir: string): Promise<string[] | null> {
  const cfgPath = path.join(rootDir, 'writerside.cfg');
  if (!fileExists(cfgPath)) return null;

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const cfgXml = parser.parse(await readText(cfgPath));
  const ihp = cfgXml?.ihp;
  if (!ihp) return null;

  const instanceDecls = normalize(ihp.instance);
  if (!instanceDecls.length) return null;

  const orderedRel: string[] = [];
  const seen = new Set<string>();

  for (const inst of instanceDecls) {
    const srcRel: string | undefined = inst?.['@_src'];
    if (!srcRel) continue;
    const treePath = path.resolve(rootDir, srcRel);
    if (!fileExists(treePath)) continue;

    const treeXml = parser.parse(await readText(treePath));
    const ip = treeXml?.['instance-profile'];
    if (!ip) continue;

    // 1) optional start-page first
    const startPage: string | undefined = ip['@_start-page'];
    if (startPage && !seen.has(startPage)) {
      orderedRel.push(startPage);
      seen.add(startPage);
    }

    // 2) DFS over toc-element in document order
    const stack = [...normalize(ip['toc-element'])].reverse(); // manual DFS using stack
    while (stack.length) {
      const node = stack.pop();
      if (!node) continue;
      const topic: string | undefined = node['@_topic'];
      if (topic && !seen.has(topic)) {
        orderedRel.push(topic);
        seen.add(topic);
      }
      const children = normalize(node['toc-element']);
      // push in reverse so first child is processed first
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
    }
  }

  // Map to absolute paths under mdDir and keep only existing
  const orderedAbs = orderedRel
    .map(rel => path.resolve(mdDir, rel))
    .filter(p => fileExists(p) && p.endsWith('.md'));

  return orderedAbs;
}

/** Authord: read topics from instances/toc-elements (DFS) */
async function collectMdFromAuthord(rootDir: string, mdDir: string): Promise<string[] | null> {
  const jsonPath = path.join(rootDir, 'authord.config.json');
  if (!fileExists(jsonPath)) return null;

  // NOTE: readAuthordConfig should resolve relative to rootDir
  const { readConfig: readAuthordConfig } = await import('./utils/readConfig.ts');
  const cfg = await readAuthordConfig(rootDir);

  const orderedRel: string[] = [];
  const seen = new Set<string>();

  if (cfg.instances && cfg.instances.length) {
    for (const inst of cfg.instances) {
      if (inst['start-page'] && !seen.has(inst['start-page']!)) {
        orderedRel.push(inst['start-page']!);
        seen.add(inst['start-page']!);
      }
      const stack = [...(inst['toc-elements'] ?? [])].reverse();
      while (stack.length) {
        const node = stack.pop();
        if (!node) continue;
        if (node.topic && !seen.has(node.topic)) {
          orderedRel.push(node.topic);
          seen.add(node.topic);
        }
        const children = node.children ?? [];
        for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
      }
    }
  }

  const orderedAbs = orderedRel
    .map(rel => path.resolve(mdDir, rel))
    .filter(p => fileExists(p) && p.endsWith('.md'));

  return orderedAbs;
}

/** Final resolver: prefer Writerside tree order, else Authord, else alphabetical. Append orphans. */
async function resolveMdInOrder(rootDir: string, mdDir: string): Promise<string[]> {
  const prefWriterside = await collectMdFromWriterside(rootDir, mdDir);
  const prefAuthord    = prefWriterside ? null : await collectMdFromAuthord(rootDir, mdDir);

  const primary = prefWriterside ?? prefAuthord ?? [];
  const all     = await listAllMdFilesRecursive(mdDir);

  if (!primary.length) {
    // Pure alphabetical if nothing else available
    return all;
  }

  const primarySet = new Set(primary.map(p => path.resolve(p)));
  const extras = all.filter(p => !primarySet.has(path.resolve(p)));

  if (extras.length) {
    console.log(`ℹ️ ${extras.length} topic(s) not referenced by any tree were appended at the end.`);
  }

  return [...primary, ...extras];
}

const extractFilenames = (xhtml: string): string[] => {
  const out: string[] = [];
  const re = /ri:filename="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xhtml))) out.push(m[1]);
  return out;
};

export async function publishSingle(options: PublishSingleOptions): Promise<void> {
  // Root directory is explicit if provided; otherwise fall back to CWD.
  const rootDir   = options.rootDir ?? process.cwd();
  const mdDir     = path.resolve(rootDir, options.md);
  const imgDir    = path.resolve(rootDir, options.images);
  const baseUrl   = options.baseUrl;
  const apiToken  = options.basicAuth ;
  const pageIdArg = options.pageId;                      // REQUIRED now
  const titleArg  = options.title;                       // optional override

  for (const [label, val] of Object.entries({ mdDir, imgDir, baseUrl, apiToken })) {
    if (!val) throw new Error(`Missing required option: ${label}`);
  }
  if (!pageIdArg) {
    throw new Error('Missing required option: pageId (page ID is now mandatory; no search/fallback).');
  }

  const cfg: ConfluenceCfg = { baseUrl, apiToken };
  if(!process.env.AUTHORD_IMAGE_DIR){
    setImageDir(imgDir);
  }
  
  // ── Strict: Validate provided --page-id and do not fall back ──
  type MinimalHit = { id: string; nextVersion: number; title: string };
  console.log(`🔍 Validating provided --page-id "${pageIdArg}"…`);
  const page = await getPageWithVersion(cfg, pageIdArg);
  const hit: MinimalHit = { id: page.id, nextVersion: page.nextVersion, title: page.title };

  // 1) Markdown → storage-XHTML + hash (using tree/instance order)
  const orderedPaths = await resolveMdInOrder(rootDir, mdDir);
  if (!orderedPaths.length) throw new Error(`No markdown files found under: ${mdDir}`);

  const mdRaw = (await Promise.all(orderedPaths.map(p => readText(p)))).join('\n\n');
  const transformer = new WritersideMarkdownTransformerDC();
  const { value: storageHtml } = await transformer.toStorage(mdRaw);
  const hash = sha256(Buffer.from(storageHtml));

  // 2) Delta check (existing page only; no create path)
  console.log(`🔍 Checking existing page ${hit.id} for changes…`);
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
    await Promise.all(miss.map(f => uploadImages(cfg, hit.id, path.join(imgDir, f))));
    console.log('✅ Attachments healed – done.');
    return;
  }

  // 3) Update body only (no auto-create)
  const effectiveTitle = titleArg ?? hit.title;
  await putPageStorage(cfg, hit.id, effectiveTitle, hit.nextVersion, storageHtml);

  // 4) Sync attachments
  const need = extractFilenames(storageHtml);
  const have = await listAttachments(cfg, hit.id);
  const miss = need.filter(f => !have.has(f));
  if (miss.length) {
    console.log(`📸 Uploading ${miss.length} attachment(s)…`);
    await Promise.all(miss.map(f => uploadImages(cfg, hit.id, path.join(imgDir, f))));
  }

  // 5) Persist hash
  await setRemoteHash(cfg, hit.id, hash);
  console.log(`✅ Published “${effectiveTitle}” (id ${hit.id})`);
}
