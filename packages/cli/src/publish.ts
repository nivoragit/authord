#!/usr/bin/env ts-node

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import axios from 'axios';
import readline from 'readline';
import { WritersideMarkdownTransformer } from '@authord/renderer-html';
import { ConfluenceCfg, injectMediaNodes, uploadImages } from './utils/confluence-utils';

async function main() {
  const [ , , mdPathOrDir, imagesPath, pageId ] = process.argv;
  if (!mdPathOrDir || !imagesPath || !pageId) {
    console.error('Usage: publish.ts <markdown-file-or-dir> <images-dir> <confluence-page-id>');
    process.exit(1);
  }

  // 1) Discover MD files
  let mdFiles: string[];
  const stat = await fs.stat(mdPathOrDir);
  if (stat.isDirectory()) {
    // get all .md in directory, sort alphabetically
    mdFiles = (await fs.readdir(mdPathOrDir))
      .filter(f => f.endsWith('.md'))
      .map(f => path.join(mdPathOrDir, f))
      .sort();
  } else {
    mdFiles = [mdPathOrDir];
  }

  if (mdFiles.length === 0) {
    console.error('No Markdown files found.');
    process.exit(1);
  }

  // 2) Read and concatenate—or transform and merge—your files
  const transformer = new WritersideMarkdownTransformer();
  const allMd = (
    await Promise.all(mdFiles.map(f => fs.readFile(f, 'utf8')))
  ).join('\n\n---\n\n');
  const adf = transformer.toADF(allMd);

  // 3) Prepare cache directory and copy images
  const cacheImagesDir = path.join(os.tmpdir(), 'writerside-diagrams');
  await fs.mkdir(cacheImagesDir, { recursive: true });
  const imageFiles = await fs.readdir(imagesPath);
  for (const img of imageFiles) {
    const src = path.join(imagesPath, img);
    const dest = path.join(cacheImagesDir, img);
    await fs.copyFile(src, dest);
  }

  // 4) Locate generated PNGs
  let pngs: string[];
  try {
    pngs = await fs.readdir(cacheImagesDir);
  } catch {
    console.error(`PNG directory not found: ${cacheImagesDir}`);
    process.exit(1);
  }

  // 5) Confirm upload
  console.log(`\nPNG files in: ${cacheImagesDir}`);
  pngs.forEach(png => console.log(`  - ${png}`));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer: string = await new Promise(resolve => {
    rl.question('\nProceed with upload? (Y/n) ', input => {
      rl.close(); resolve(input.trim());
    });
  });
  if (answer.toLowerCase().startsWith('n')) {
    console.log('Aborted by user.');
    process.exit(0);
  }

  // 6) Confluence credentials
  const cfg: ConfluenceCfg = {
    baseUrl : process.env.CONF_BASE_URL as string,
    email   : process.env.CONF_USER     as string,
    apiToken: process.env.CONF_TOKEN    as string,
  };

  // 7) Upload PNGs & build map
  const fileToMedia: Record<string,string> = {};
  for (const png of pngs) {
    console.log(`Uploading ${png}...`);
    const { file, mediaId } = await uploadImages(cfg, pageId, path.join(cacheImagesDir, png));
    fileToMedia[file] = mediaId;
  }

  // 8) Inject mediaSingle/media nodes
  const finalAdf = injectMediaNodes(adf, fileToMedia, pageId, cacheImagesDir);

  // 9) Fetch metadata & bump version
  const pageResp = await axios.get(
    `${cfg.baseUrl}/wiki/rest/api/content/${pageId}?expand=version,title`,
    { auth: { username: cfg.email, password: cfg.apiToken } }
  );
  const { title, version: { number: currentVersion } } = pageResp.data;
  const nextVersion = currentVersion + 1;

  // 10) Push updated ADF
  await axios.put(
    `${cfg.baseUrl}/wiki/rest/api/content/${pageId}`,
    {
      id     : pageId,
      type   : 'page',
      title  : title,
      version: { number: nextVersion },
      body   : {
        atlas_doc_format: {
          value         : JSON.stringify(finalAdf),
          representation: 'atlas_doc_format'
        }
      }
    },
    {
      headers: { 'Content-Type': 'application/json' },
      auth   : { username: cfg.email, password: cfg.apiToken }
    }
  );

  console.log('✅ Page updated successfully with inline PNG media.');
}

main().catch(err => {
  console.error('❌ Error in publish.ts:', err);
  process.exit(1);
});



//todo md fiels need to sort by created date before merge
