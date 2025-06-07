// src/commands/lint.ts
//
// Efficient ✨ – separates config-path errors from markdown-lint results.

import path from 'path';
import fs from 'fs';
import {
  AuthordConfig,
  InstanceProfile,
  readConfig,
  TocElement
} from '@authord/core';
import {
  validateMarkdown,
  ValidationResult
} from '../linter/markdown-validator';

export async function lintCommand() {
  const projectRoot = process.cwd();

  /* ---------- 1. read config ---------- */
  let config: AuthordConfig;
  try {
    config = await readConfig(projectRoot);
    console.log('✓ Configuration valid');
  } catch (err: any) {
    console.error('Configuration error:', err.message);
    process.exit(1);
  }

  /* ---------- 2. non-markdown checks ---------- */
  const pathErrors: { path: string; reason: string }[] = [];

  checkDir(config.topics?.dir, 'Topics', pathErrors, projectRoot);
  checkDir(config.images?.dir, 'Images', pathErrors, projectRoot);

  if (config.instances) {
    for (const inst of config.instances) {
      // start page
      if (inst['start-page']) {
        validateTopicFile(inst, inst['start-page'], 'Start page', pathErrors, config.topics?.dir);
      }
      // toc
      inst['toc-elements'].forEach((toc) =>
        validateTocElement(inst, toc, pathErrors, config.topics?.dir)
      );
    }
  }

  if (pathErrors.length) {
    printPathErrors(pathErrors);
    process.exit(1);
  }
  console.log('✓ All directories and topic files exist');

  /* ---------- 3. markdown lint ---------- */
  const mdErrors: ValidationResult[] = [];
  for (const doc of config.documents ?? []) {
    const filePath = path.resolve(config.root ?? projectRoot, doc.path);
    const res = await validateMarkdown(filePath);
    if (res.errors.length) mdErrors.push(res);
  }

  if (mdErrors.length) {
    printMarkdownErrors(mdErrors);
    process.exit(1);
  }

  console.log('✅ All markdown resources are valid');
  process.exit(0);
}

/* ───────── helpers ───────── */

function checkDir(
  dir: string | undefined,
  label: string,
  errs: { path: string; reason: string }[],
  root: string
) {
  if (!dir) return;
  const abs = path.resolve(root, dir);
  if (!fs.existsSync(abs)) {
    errs.push({ path: dir, reason: `${label} directory not found` });
  } else if (!fs.statSync(abs).isDirectory()) {
    errs.push({ path: dir, reason: `${label} path is not a directory` });
  }
}

function validateTocElement(
  inst: InstanceProfile,
  toc: TocElement,
  errs: { path: string; reason: string }[],
  topicsDir: string | undefined
) {
  validateTopicFile(inst, toc.topic, 'TOC element', errs, topicsDir);
  toc.children.forEach((child) =>
    validateTocElement(inst, child, errs, topicsDir)
  );
}

function validateTopicFile(
  inst: InstanceProfile,
  topicPath: string,
  context: string,
  errs: { path: string; reason: string }[],
  topicsDir: string | undefined
) {
  if (!topicsDir) {
    errs.push({
      path: topicPath,
      reason: `${context} referenced but topics directory not configured`
    });
    return;
  }
  const full = path.resolve(topicsDir, topicPath);
  if (!fs.existsSync(full)) {
    errs.push({
      path: topicPath,
      reason: `${context} for instance '${inst.id}' not found`
    });
  } else if (path.extname(full) !== '.md') {
    errs.push({
      path: topicPath,
      reason: `${context} for instance '${inst.id}' is not a markdown file`
    });
  }
}

/* ---------- pretty printers ---------- */

function printPathErrors(errs: { path: string; reason: string }[]) {
  console.error('\nLint errors (paths):');
  errs.forEach((e, i) => console.error(`${i + 1}. ${e.path} – ${e.reason}`));
}

function printMarkdownErrors(results: ValidationResult[]) {
  results.forEach((r) => {
    console.error(`\n❌ ${path.relative(process.cwd(), r.filePath)}`);
    r.errors.forEach((e) => console.error(`  ⚠ ${e.type}: ${e.message}`));
  });
}
