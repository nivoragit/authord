import fs from 'fs';
import path from 'path';
import { XMLParser } from 'fast-xml-parser';
import { validateMarkdown, ValidationResult } from './markdown-validator';

type Err = { path: string; reason: string };

const parser = new XMLParser({
  ignoreAttributes   : false,
  attributeNamePrefix: '@_',
});

/** Validate a Writerside project (.cfg) and exit(1) with a clear report on error. */
export async function validateWritersideProject(
  root: string = process.cwd(),
): Promise<void> {
  const errs: Err[] = [];

  /* -------------------------------------------------- 1. Locate .cfg file */
  const cfgPath = findCfgFile(root);
  if (!cfgPath) {
    errs.push({ path: 'Project root', reason: 'No *.cfg Writerside config found' });
    exitIfErr();
  }

  /* -------------------------------------------------- 2. Parse config — only <cfg> allowed */
  const raw = safeParseXml(cfgPath!, errs);
  const cfg = raw.ihp;
  if (!cfg) {
    errs.push({ path: cfgPath!, reason: 'Missing <cfg> root element' });
    exitIfErr();
  }

  const topicsDirRel = cfg.topics?.['@_dir'];
  const imagesDirRel = cfg.images?.['@_dir'];
  const instancesRaw = cfg.instance
    ? (Array.isArray(cfg.instance) ? cfg.instance : [cfg.instance])
    : [];

  /* -------------------------------------------------- 3. Directory checks */
  checkDir(topicsDirRel, 'Topics directory', errs, root);
  checkDir(imagesDirRel, 'Images directory', errs, root);

  /* -------------------------------------------------- 4. Validate each .tree file */
  const treeFiles = instancesRaw
    .map((i: any) => i['@_src'])
    .filter(Boolean) as string[];

  for (const src of treeFiles) {
    const abs = path.resolve(root, src);
    if (!fs.existsSync(abs)) {
      errs.push({ path: src, reason: 'Tree file not found' });
    } else {
      validateTree(abs, path.resolve(root, topicsDirRel ?? ''), errs);
    }
  }

  /* -------------------------------------------------- 5. Optional markdown-lint pass */
  await lintAllReferencedMd(errs);

  /* -------------------------------------------------- 6. Finish up */
  exitIfErr();

  /* ──────────── Local helpers ──────────── */

  function exitIfErr(): never | void {
    if (!errs.length) return;
    console.error('\n❌  Validation errors:');
    errs.forEach((e, i) => console.error(`${i + 1}. ${e.path} – ${e.reason}`));
    console.error('❌ Validation failed');
    process.exit(1);
  }
}

/* ───────────────────────── Internal helpers ───────────────────────── */

function findCfgFile(root: string): string | null {
  const file = fs.readdirSync(root).find(f => f.endsWith('.cfg'));
  return file ? path.join(root, file) : null;
}

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
  if (!fs.existsSync(abs)) {
    errs.push({ path: rel, reason: `${label} not found` });
  } else if (!fs.statSync(abs).isDirectory()) {
    errs.push({ path: rel, reason: `${label} is not a directory` });
  }
}

function validateTree(treePath: string, topicsAbs: string, errs: Err[]) {
  const xmlObj = safeParseXml(treePath, errs)['instance-profile'];
  if (!xmlObj) {
    errs.push({ path: treePath, reason: 'Missing <instance-profile>' });
    return;
  }

  const instId = xmlObj['@_id'] ?? '(unknown)';

  // Validate start-page
  if (xmlObj['@_start-page']) {
    checkTopic(xmlObj['@_start-page'], 'Start page', instId);
  }

  // Recurse TOC elements
  const roots = normalize(xmlObj['toc-element']);
  roots.forEach(walkToc);

  function walkToc(node: any) {
    if (!node) return;
    if (node['@_topic']) {
      checkTopic(node['@_topic'], 'TOC element', instId);
    }
    normalize(node['toc-element']).forEach(walkToc);
  }

  function checkTopic(relTopic: string, ctx: string, id: string) {
    const full = path.join(topicsAbs, relTopic);
    if (!fs.existsSync(full)) {
      errs.push({ path: relTopic, reason: `${ctx} for '${id}' not found` });
    } else if (path.extname(full) !== '.md') {
      errs.push({ path: relTopic, reason: `${ctx} for '${id}' is not .md` });
    }
  }

  function normalize(x: any): any[] {
    if (!x) return [];
    return Array.isArray(x) ? x : [x];
  }
}

/** Run markdown-lint over each referenced .md that actually exists */
async function lintAllReferencedMd(errs: Err[]): Promise<void> {
  const paths = errs
    .filter(e => !e.reason.includes('not found'))
    .map(e => e.path)
    .filter(p => p.endsWith('.md') && fs.existsSync(p));

  const lintErrs: ValidationResult[] = [];
  for (const p of paths) {
    const res = await validateMarkdown(p);
    if (res.errors.length) lintErrs.push(res);
  }
  if (!lintErrs.length) return;

  lintErrs.forEach(r => {
    console.error(`\n❌ ${path.relative(process.cwd(), r.filePath)}`);
    r.errors.forEach(e => console.error(`   ⚠ ${e.type}: ${e.message}`));
  });
  process.exit(1);
}