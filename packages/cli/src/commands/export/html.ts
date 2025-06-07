/**
 * authord-cli → export html
 *
 *   $ authord-cli export html
 *   $ authord-cli export html -o dist
 *   $ authord-cli export html --inline-assets
 */

import { Command } from 'commander';
import path from 'path';
import fs from 'fs-extra';
import { readConfig } from '@authord/core';
import { renderHtml } from '@authord/renderer-html';

export default new Command('html')
  .description('Export project to single-page HTML')
  .option('-o, --output <dir>', 'Output directory', './build/html')
  .option('-i, --inline-assets', 'Bundle images/fonts as data URIs')
  .action(async (opts) => {
    const projectRoot = process.cwd();
    const outDir = path.resolve(projectRoot, opts.output);
    await fs.ensureDir(outDir);

    /* 1️⃣  read project config (already validated with zod) */
    const cfg = await readConfig(projectRoot);

    /* 2️⃣  locate Markdown documents
           – grab every *.md under topics/dir (default 'topics')          */
    const topicsRel = cfg.topics?.dir ?? 'topics';
    const topicsAbs = path.resolve(projectRoot, topicsRel);
    if (!fs.existsSync(topicsAbs)) {
      console.error(`Topics directory not found: ${topicsRel}`);
      process.exit(1);
    }
    const mdFiles: string[] = [];
    await collectMd(topicsAbs, mdFiles);
    if (mdFiles.length === 0) {
      console.error('No Markdown files found in topics directory');
      process.exit(1);
    }

    /* 3️⃣  render → single HTML (+ asset list) */
    const { html, assets } = await renderHtml(mdFiles, {
      inlineAssets: !!opts.inlineAssets,
      projectTitle: cfg.title ?? path.basename(projectRoot),
    });

    /* 4️⃣  copy assets when not inlined */
    if (!opts.inlineAssets && assets.length) {
      const assetsDir = path.join(outDir, 'assets');
      await fs.ensureDir(assetsDir);
      await Promise.all(
        assets.map(async (rel) => {
          const src = path.resolve(topicsAbs, rel);
          const dest = path.join(assetsDir, path.basename(rel));
          if (await fs.pathExists(src)) {
            await fs.copy(src, dest);
          }
        }),
      );
    }

    /* 5️⃣  write HTML */
    await fs.writeFile(path.join(outDir, 'index.html'), html, 'utf8');
    console.log(
      `✅ HTML exported → ${path.relative(
        projectRoot,
        path.join(outDir, 'index.html'),
      )}`,
    );
  });

/* -------------------------------------------------------------------------- */
/* recursive helper: push absolute *.md paths into list                       */
/* -------------------------------------------------------------------------- */
async function collectMd(dir: string, out: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  await Promise.all(
    entries.map(async (e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return collectMd(full, out);
      if (e.isFile() && full.endsWith('.md')) out.push(full);
    }),
  );
}
