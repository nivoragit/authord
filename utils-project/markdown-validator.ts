// src/utils/markdown-validator.ts
//
// Efficient ✨ – single-pass heading + link + image validation.

import fs from 'fs-extra';
import path from 'path';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { visit } from 'unist-util-visit';
import GithubSlugger from 'github-slugger';
import { ValidationResult } from './types';

export async function validateMarkdown(
  filePath: string,
  imagesDir?: string        // ← optional shared images folder
): Promise<ValidationResult> {
  const raw  = await fs.readFile(filePath, 'utf8');
  const tree = unified().use(remarkParse).parse(raw);

  const result: ValidationResult = { filePath, errors: [] };
  const slugger        = new GithubSlugger();
  const headingAnchors = new Set<string>();

  /* -------- single-pass walk -------- */
  visit(tree, (node) => {
    if (node.type === 'heading') {
      const text = (node.children ?? [])
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.value)
        .join(' ');
      headingAnchors.add(slugger.slug(text));
    }

    if (node.type === 'link') {
      validateAnchor(node, filePath, headingAnchors, result);
      validateLink(node.url, filePath, result);
    }

    if (node.type === 'image') {
      validateImage(node.url, filePath, result, imagesDir);
    }
  });

  /* ✅ keep this log so callers print one line per file */
  console.log(`Validated ${filePath}: ${result.errors.length} errors found`);
  return result;
}

/* ---------- helpers ---------- */

const EXTERNAL_RE = /^(?:[a-z]+:)?\/\//i;

const isInternal = (href: string) =>
  !EXTERNAL_RE.test(href) && !href.startsWith('mailto:');

const resolve = (rel: string, base: string) =>
  path.resolve(path.dirname(base), rel);

function validateLink(url: string, base: string, res: ValidationResult) {
  if (!isInternal(url) || url.includes('#')) return;
  const resolved = resolve(url, base);
  if (!fs.existsSync(resolved)) {
    res.errors.push({ type: 'LINK', target: url, message: `Broken link to ${resolved}` });
  }
}

function validateImage(
  url: string,
  base: string,
  res: ValidationResult,
  imagesDir?: string
) {
  let resolved = path.resolve(path.dirname(base), url);
  let ok = fs.existsSync(resolved);

  /* fall back to shared /images */
  if (!ok && imagesDir) {
    resolved = path.resolve(imagesDir, url);
    ok = fs.existsSync(resolved);
  }

  
  // console.log(
  //   ok
  //     ? `   ✓ image OK   ${url}  →  ${resolved}`
  //     : `   ⚠ image MISS ${url}  →  ${resolved}`
  // );

  if (!ok) {
    console.log(`   ❌ Missing image: ${resolved}`);
    res.errors.push({
      type: 'IMAGE',
      target: url,
      message: `Missing image at ${resolved}`
    });

  }
}


function validateAnchor(
  node: any,
  base: string,
  anchors: Set<string>,
  res: ValidationResult
) {
  const [file, anchor] = node.url.split('#', 2);
  if (!anchor) return;

  if (!file) {
    if (!anchors.has(anchor)) {
      res.errors.push({ type: 'ANCHOR', target: `#${anchor}`, message: `Missing anchor target: #${anchor}` });
    }
    return;
  }

  const resolved = resolve(file, base);
  if (!fs.existsSync(resolved)) {
    res.errors.push({ type: 'LINK', target: node.url, message: `Broken cross-document link: ${resolved}` });
  }
}
