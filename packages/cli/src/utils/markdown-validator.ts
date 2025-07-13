// src/utils/markdownValidator.ts
//
// Efficient ✨ – single-pass heading + link + image validation.
//
// Add deps:
//   npm i remark-parse unist-util-visit github-slugger fs-extra

import fs from 'fs-extra';
import path from 'path';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { visit } from 'unist-util-visit';
import GithubSlugger from 'github-slugger';

export interface ValidationError {
  type: 'LINK' | 'IMAGE' | 'ANCHOR';
  target: string;
  message: string;
}

export interface ValidationResult {
  filePath: string;
  errors: ValidationError[];
}

export async function validateMarkdown(
  filePath: string
): Promise<ValidationResult> {
  const raw = await fs.readFile(filePath, 'utf8');
  const tree = unified().use(remarkParse).parse(raw);

  const result: ValidationResult = { filePath, errors: [] };
  const slugger = new GithubSlugger();
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
      validateLink(node.url, filePath, result); // plain links
    }

    if (node.type === 'image') {
      validateImage(node.url, filePath, result);
    }
  });

  return result;
}

/* ---------- helpers ---------- */

const EXTERNAL_RE = /^(?:[a-z]+:)?\/\//i;

function isInternalLink(href: string): boolean {
  return !EXTERNAL_RE.test(href) && !href.startsWith('mailto:');
}

function resolveInternalPath(relative: string, base: string): string {
  return path.resolve(path.dirname(base), relative);
}

function validateLink(url: string, base: string, res: ValidationResult) {
  if (!isInternalLink(url) || url.includes('#')) return;
  const resolved = resolveInternalPath(url, base);
  if (!fs.existsSync(resolved)) {
    res.errors.push({
      type: 'LINK',
      target: url,
      message: `Broken link to ${resolved}`
    });
  }
}

function validateImage(url: string, base: string, res: ValidationResult) {
  const resolved = resolveInternalPath(url, base);
  if (!fs.existsSync(resolved)) {
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
  const [filePath, anchor] = node.url.split('#', 2);
  if (!anchor) return;

  // same-doc anchor
  if (!filePath) {
    if (!anchors.has(anchor)) {
      res.errors.push({
        type: 'ANCHOR',
        target: `#${anchor}`,
        message: `Missing anchor target: #${anchor}`
      });
    }
    return;
  }

  // cross-doc: verify file exists (heading check can be added later)
  const resolved = resolveInternalPath(filePath, base);
  if (!fs.existsSync(resolved)) {
    res.errors.push({
      type: 'LINK',
      target: node.url,
      message: `Broken cross-document link: ${resolved}`
    });
  }
}
