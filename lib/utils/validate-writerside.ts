import fs from 'node:fs';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { validateMarkdown } from './markdown-validator.ts';
import { ValidationResult } from './types.ts';

type Err = { path: string; reason: string };

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

export async function validateWritersideProject(
  root: string = process.cwd(),
): Promise<void> {
  const errs: Err[] = [];

  /* 1️⃣  find project .cfg */
  const cfgPath = fs.readdirSync(root).find(f => f.endsWith('.cfg'));
  if (!cfgPath) {
    finish([{ path: 'Project root', reason: 'No *.cfg Writerside config found' }]);
    return;
  }

  /* 2️⃣  parse .cfg */
  const cfgXml = safeParseXml(path.join(root, cfgPath), errs);
  const cfg = cfgXml.ihp;
  if (!cfg) finish([{ path: cfgPath, reason: 'Missing <cfg> root element' }]);

  const topicsDirRel  = cfg.topics?.['@_dir']  as string | undefined;
  const imagesDirRel  = cfg.images?.['@_dir']  as string | undefined;
  const topicsAbs     = topicsDirRel ? path.resolve(root, topicsDirRel) : '';
  const imagesAbs     = imagesDirRel ? path.resolve(root, imagesDirRel) : undefined;

  /* 3️⃣  basic directory existence */
  checkDir(topicsDirRel, 'Topics directory', errs, root);
  checkDir(imagesDirRel, 'Images directory', errs, root);

  /* 4️⃣  validate *.tree files */
  const instanceArr = cfg.instance ? (Array.isArray(cfg.instance) ? cfg.instance : [cfg.instance]) : [];
  const treeFiles   = instanceArr.map((i: any) => i['@_src']).filter(Boolean) as string[];

  treeFiles.forEach(src => {
    const abs = path.resolve(root, src);
    if (!fs.existsSync(abs)) errs.push({ path: src, reason: 'Tree file not found' });
    else validateTree(abs, topicsAbs, errs);
  });

  /* 5️⃣  markdown-lint every topic file (uses shared images dir) */
  await lintAllTopics(topicsAbs, imagesAbs, errs);

  finish(errs);

  /* ───────── helpers ───────── */
  function finish(errors: Err[]): never | void {
    if (!errors.length) {
      console.log('✅ Validation passed');
      return;
    }
    console.error('\n❌  Validation errors:');
    errors.forEach((e, i) => console.error(`${i + 1}. ${e.path} – ${e.reason}`));
    process.exit(1);
  }
}

/* ---------- file / dir helpers ---------- */

function safeParseXml(p: string, errs: Err[]): any {
  try {
    return parser.parse(fs.readFileSync(p, 'utf8'));
  } catch (e: any) {
    errs.push({ path: p, reason: `XML parse error: ${e.message}` });
    return {};
  }
}

function checkDir(rel: string | undefined, label: string, errs: Err[], root: string) {
  if (!rel) return;
  const abs = path.resolve(root, rel);
  if (!fs.existsSync(abs)) errs.push({ path: rel, reason: `${label} not found` });
  else if (!fs.statSync(abs).isDirectory()) errs.push({ path: rel, reason: `${label} is not a directory` });
}

/* ---------- .tree validation ---------- */

function validateTree(treePath: string, topicsAbs: string, errs: Err[]) {
  const xmlObj = safeParseXml(treePath, errs)['instance-profile'];
  if (!xmlObj) { errs.push({ path: treePath, reason: 'Missing <instance-profile>' }); return; }

  const instId = xmlObj['@_id'] ?? '(unknown)';

  if (xmlObj['@_start-page']) checkTopic(xmlObj['@_start-page'], 'Start page', instId);
  normalize(xmlObj['toc-element']).forEach(walkToc);

  function walkToc(node: any) {
    if (!node) return;
    if (node['@_topic']) checkTopic(node['@_topic'], 'TOC element', instId);
    normalize(node['toc-element']).forEach(walkToc);
  }

  function checkTopic(relTopic: string, ctx: string, id: string) {
    const full = path.join(topicsAbs, relTopic);
    if (!fs.existsSync(full)) errs.push({ path: relTopic, reason: `${ctx} for '${id}' not found` });
    else if (path.extname(full) !== '.md') errs.push({ path: relTopic, reason: `${ctx} for '${id}' is not .md` });
  }

  function normalize(x: any): any[] { return !x ? [] : Array.isArray(x) ? x : [x]; }
}

/* ---------- lint all topics ---------- */

async function lintAllTopics(
  topicsAbs: string,
  imagesAbs: string | undefined,
  _errs: Err[]
): Promise<void> {
  if (!topicsAbs || !fs.existsSync(topicsAbs)) return;

  const mdFiles: string[] = [];
  (function walk(dir: string) {
    for (const entry of fs.readdirSync(dir)) {
      const abs = path.join(dir, entry);
      const s   = fs.statSync(abs);
      if (s.isDirectory()) walk(abs);
      else if (entry.endsWith('.md')) mdFiles.push(abs);
    }
  })(topicsAbs);

  const lintErrs: ValidationResult[] = [];
  for (const file of mdFiles) {
    const res = await validateMarkdown(file, imagesAbs);
    if (res.errors.length) lintErrs.push(res);
  }
  if (!lintErrs.length) return;

  lintErrs.forEach(r => {
    console.error(`\n❌ ${path.relative(process.cwd(), r.filePath)}`);
    r.errors.forEach(e => console.error(`   ⚠ ${e.type}: ${e.message}`));
  });
  process.exit(1);
}
