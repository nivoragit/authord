#!/usr/bin/env ts-node

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import axios from 'axios';
import readline from 'readline';
import { WritersideMarkdownTransformer } from '@authord/renderer-html';
import { ConfluenceCfg, injectMediaNodes, uploadPng } from './utils/confluence-utils';

async function main() {
  const [ , , mdPath, pageId ] = process.argv;
  if (!mdPath || !pageId) {
    console.error('Usage: publish.ts <markdown-file> <confluence-page-id>');
    process.exit(1);
  }

  // 1. Read the Markdown file
  const md = await fs.readFile(mdPath, 'utf8');

  // 2. Transform Markdown → ADF (this also generates PNGs)
  const transformer = new WritersideMarkdownTransformer();
  const adf = transformer.toADF(md);

  // 3. Locate generated PNGs
  const pngDir = path.join(os.tmpdir(), 'writerside-diagrams');
  let pngs: string[];
  try {
    pngs = await fs.readdir(pngDir);
  } catch {
    console.error(`PNG directory not found: ${pngDir}`);
    process.exit(1);
  }

  // 4. Confirm upload
  console.log(`\nPNG files generated in: ${pngDir}`);
  console.log('Found the following PNG files:');
  pngs.forEach(png => console.log(`  - ${png}`));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer: string = await new Promise(resolve => {
    rl.question('\nProceed with upload? (Y/n) ', input => {
      rl.close();
      resolve(input.trim());
    });
  });
  if (answer.toLowerCase().startsWith('n')) {
    console.log('Aborted by user.');
    process.exit(0);
  }

  // 5. Confluence credentials
  const cfg: ConfluenceCfg = {
    baseUrl : process.env.CONF_BASE_URL as string,
    email   : process.env.CONF_USER     as string,
    apiToken: process.env.CONF_TOKEN    as string,
  };

  // 6. Upload PNGs & build map
  const fileToMedia: Record<string,string> = {};
  for (const png of pngs) {
    console.log(`Uploading ${png}...`);
    const { file, mediaId } = await uploadPng(cfg, pageId, path.join(pngDir, png));
    fileToMedia[file] = mediaId;
  }
  // 7. Inject mediaSingle/media nodes (now includes attrs.id)
  const finalAdf = injectMediaNodes(adf, fileToMedia, pageId);

  // 8. Fetch page metadata for version bump
  const pageResp = await axios.get(
    `${cfg.baseUrl}/wiki/rest/api/content/${pageId}?expand=version,title`,
    { auth: { username: cfg.email, password: cfg.apiToken } }
  );
  const {
    title,
    version: { number: currentVersion }
  } = pageResp.data;
  const nextVersion = currentVersion + 1;
  // 9. Push updated ADF back to Confluence
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
