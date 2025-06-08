#!/usr/bin/env ts-node
/**
 * Render EVERY .md file under a folder → one HTML page.
 *
 * Usage examples
 *   npx ts-node scripts/render-all-markdown.ts ./docs ./build/all.html
 *   npx ts-node scripts/render-all-markdown.ts ./docs ./build/all.html --inline
 */

import path from 'path';
import fs from 'fs-extra';
import fg from 'fast-glob';
import { htmlRenderer } from './htmlRenderer';


export async function render_all() {
  const [srcDir = '.', outFile = './build/all.html', flag] = process.argv.slice(2);
  const inlineAssets = flag === '--inline';

  /* 1️⃣  gather Markdown files (fast-glob is ~50× quicker than readdir-recursion) */
  const mdFiles = await fg('**/*.md', {
    cwd: srcDir,
    absolute: true,
    dot: false,
  });
  if (!mdFiles.length) {
    console.error(`No .md files found in ${srcDir}`);
    process.exit(1);
  }

  /* 2️⃣  render */
  const { html, assets } = await htmlRenderer(mdFiles, {
    inlineAssets,
    projectTitle: path.basename(srcDir),
  });

  /* 3️⃣  write html + optionally copy assets */
  await fs.ensureDir(path.dirname(outFile));
  await fs.writeFile(outFile, html, 'utf8');

  if (!inlineAssets && assets.length) {
    const assetsDir = path.join(path.dirname(outFile), 'assets');
    await fs.ensureDir(assetsDir);
    await Promise.all(
      assets.map(async (rel) => {
        const src = path.resolve(srcDir, rel);
        const dest = path.join(assetsDir, path.basename(rel));
        await fs.copy(src, dest);
      }),
    );
  }

  console.log(`✅ Combined HTML saved to ${path.relative(process.cwd(), outFile)}`);
}


