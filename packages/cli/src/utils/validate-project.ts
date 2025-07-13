import path from 'path';
import fs   from 'fs';
import {
  AuthordConfig,
  InstanceProfile,
  TocElement
} from '@authord/core';
import {
  validateMarkdown,
  ValidationResult,
} from './markdown-validator';
import { readConfig } from './readConfig';

/** Validates project; on error prints details and exits with code 1. */
export async function validateProject(root: string = process.cwd()): Promise<void> {
  const cfg: AuthordConfig = await readConfig(root);

  /* -------- 1. Non-markdown path checks ---------------- */
  const pathErrors: { path: string; reason: string }[] = [];
  checkDir(cfg.topics?.dir,  'Topics', pathErrors, root);
  checkDir(cfg.images?.dir,  'Images', pathErrors, root);

  if (cfg.instances) {
    for (const inst of cfg.instances) {
      if (inst['start-page']) {
        validateTopicFile(inst, inst['start-page'], 'Start page', pathErrors, cfg.topics?.dir);
      }
      inst['toc-elements'].forEach(t =>
        validateTocElement(inst, t, pathErrors, cfg.topics?.dir),
      );
    }
  }
  if (pathErrors.length) {
    printPathErrors(pathErrors);
    console.error('❌ Project contains invalid paths');
    process.exit(1);
  }

  /* -------- 2. Markdown-lint pass ---------------------- */
  const mdErrors: ValidationResult[] = [];
  for (const doc of cfg.documents ?? []) {
    const filePath = path.resolve(cfg.root ?? root, doc.path);
    const res      = await validateMarkdown(filePath);
    if (res.errors.length) mdErrors.push(res);
  }
  if (mdErrors.length) {
    printMarkdownErrors(mdErrors);
    console.error('❌ Markdown validation failed');
    process.exit(1);
  }
}

/* ───────── internal helpers ───────── */

function checkDir(
  dir: string | undefined,
  label: string,
  errs: { path: string; reason: string }[],
  root: string,
) {
  if (!dir) return;
  const abs = path.resolve(root, dir);
  if (!fs.existsSync(abs)) errs.push({ path: dir, reason: `${label} directory not found` });
  else if (!fs.statSync(abs).isDirectory()) errs.push({ path: dir, reason: `${label} path is not a directory` });
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
