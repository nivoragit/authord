import fs from 'fs';
import path from 'path';
import { validateMarkdown } from './markdown-validator';
import { readConfig } from './readConfig';
import { AuthordConfig, InstanceProfile, TocElement, ValidationResult } from './types';

/** Validates an Authord project; exits with code 1 on any error. */
export async function validateAuthordProject(root: string = process.cwd()): Promise<void> {
  const cfg: AuthordConfig = await readConfig(root);
  const errs: { path: string; reason: string }[] = [];

  /* ── 1. Directory sanity checks ─────────────────────────────── */
  checkDir(cfg.topics?.dir,  'Topics', errs, root);
  checkDir(cfg.images?.dir,  'Images', errs, root);

  /* ── 2. Instance & TOC path checks ──────────────────────────── */
  if (cfg.instances) {
    for (const inst of cfg.instances) {
      if (inst['start-page']) {
        validateTopicFile(inst, inst['start-page'], 'Start page', errs, cfg.topics?.dir);
      }
      inst['toc-elements'].forEach(t =>
        validateTocElement(inst, t, errs, cfg.topics?.dir)
      );
    }
  }

  /* ── 3. Abort early if any non-markdown path errors ─────────── */
  if (errs.length) {
    printPathErrors(errs);
    console.error('❌ Project contains invalid paths');
    process.exit(1);
  }

  /* ── 4. Markdown-lint every topic file ──────────────────────── */
  const topicsAbs  = cfg.topics?.dir  ? path.resolve(cfg.root ?? root, cfg.topics.dir)  : '';
  const imagesAbs  = cfg.images?.dir  ? path.resolve(cfg.root ?? root, cfg.images.dir)  : undefined;
  const mdFiles: string[] = [];

  if (topicsAbs && fs.existsSync(topicsAbs)) {
    (function walk(dir: string) {
      for (const entry of fs.readdirSync(dir)) {
        const abs = path.join(dir, entry);
        const stat = fs.statSync(abs);
        if (stat.isDirectory()) walk(abs);
        else if (entry.endsWith('.md')) mdFiles.push(abs);
      }
    })(topicsAbs);
  }

  const mdErrors: ValidationResult[] = [];
  for (const file of mdFiles) {
    const res = await validateMarkdown(file, imagesAbs);      // ← passes shared images dir
    if (res.errors.length) mdErrors.push(res);
  }

  if (mdErrors.length) {
    printMarkdownErrors(mdErrors);
    console.error('❌ Markdown validation failed');
    process.exit(1);
  }

  console.log('✅ Project validation passed');
}

/* ───────────────────────── helpers ───────────────────────── */

function checkDir(
  rel: string | undefined,
  label: string,
  errs: { path: string; reason: string }[],
  root: string,
) {
  if (!rel) return;
  const abs = path.resolve(root, rel);
  if (!fs.existsSync(abs))
    errs.push({ path: rel, reason: `${label} directory not found` });
  else if (!fs.statSync(abs).isDirectory())
    errs.push({ path: rel, reason: `${label} path is not a directory` });
}

function validateTocElement(
  inst: InstanceProfile,
  toc: TocElement,
  errs: { path: string; reason: string }[],
  topicsDir: string | undefined,
) {
  validateTopicFile(inst, toc.topic, 'TOC element', errs, topicsDir);
  toc.children.forEach(c => validateTocElement(inst, c, errs, topicsDir));
}

function validateTopicFile(
  inst: InstanceProfile,
  topicPath: string,
  ctx: string,
  errs: { path: string; reason: string }[],
  topicsDir: string | undefined,
) {
  if (!topicsDir) {
    errs.push({ path: topicPath, reason: `${ctx} referenced but topics directory not configured` });
    return;
  }
  const full = path.resolve(topicsDir, topicPath);
  if (!fs.existsSync(full))
    errs.push({ path: topicPath, reason: `${ctx} for instance '${inst.id}' not found` });
  else if (path.extname(full) !== '.md')
    errs.push({ path: topicPath, reason: `${ctx} for instance '${inst.id}' is not a markdown file` });
}

/* ---------- pretty printers ---------- */

function printPathErrors(errs: { path: string; reason: string }[]) {
  console.error('\n❌  Lint errors (paths):');
  errs.forEach((e, i) => console.error(`${i + 1}. ${e.path} – ${e.reason}`));
}

function printMarkdownErrors(results: ValidationResult[]) {
  results.forEach(r => {
    console.error(`\n❌ ${path.relative(process.cwd(), r.filePath)}`);
    r.errors.forEach(e => console.error(`   ⚠ ${e.type}: ${e.message}`));
  });
}
