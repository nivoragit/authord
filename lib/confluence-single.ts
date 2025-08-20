import { Command } from "commander";
import * as path from "node:path";
import * as fs from "node:fs";
import process from "node:process";

import { publishSingle } from "./publish-single.ts";
import type { PublishSingleOptions } from "./utils/types.ts";
import { validateAuthordProject } from "./utils/validate-project.ts";
import { validateWritersideProject } from "./utils/validate-writerside.ts";

const PROJECT_CONFIG_FILES = ['authord.config.json', 'writerside.cfg'];

/* ── Help: environment variables (shows current values + defaults) ───────── */
function envOrDef(name: string, def: string) {
  const v = process.env[name];
  return v ? `${v} (current)` : `${def} (default)`;
}

const ENV_HELP = `
Environment variables

  Confluence auth/config (alternatives to flags)
    CONF_BASE_URL                 ${envOrDef('CONF_BASE_URL', '(unset)')}
      Alternative to --base-url.
    CONF_BASIC_AUTH              ${envOrDef('CONF_BASIC_AUTH', '(unset)')}
      Alternative to --basic-auth (format: user:pass).

  Images (attachments)
    AUTHORD_IMAGE_DIR             ${envOrDef('AUTHORD_IMAGE_DIR', 'images')}
      Directory where generated PNGs are linked/copied for Confluence attachments.

  Mermaid rendering (JS API; Puppeteer-backed)
    AUTHORD_MERMAID_FALLBACK_CLI  ${envOrDef('AUTHORD_MERMAID_FALLBACK_CLI', '0')}
      Enable CLI fallback if JS API fails. Accepted truthy values: 1,true,on,yes.
    MMD_WIDTH                     ${envOrDef('MMD_WIDTH',  '800')}
    MMD_HEIGHT                    ${envOrDef('MMD_HEIGHT', '600')}
    MMD_SCALE                     ${envOrDef('MMD_SCALE',  '1')}
    MMD_BG                        ${envOrDef('MMD_BG',     'white')}
      Viewport and background color for Mermaid renders.

Notes
  • CLI renders are fastest via the JS API with Puppeteer; the CLI fallback is a safety net.
  • Headless Chromium launches with --no-sandbox and --disable-setuid-sandbox by default (good for CI/DC).
  • Generated images are cached and linked under AUTHORD_IMAGE_DIR; attachments are uploaded as needed.
`;

/* ─────────────────────────────────────────────────────────────────────────── */

export function makeConfluenceSingle(): Command {
  const cmd = new Command("confluence-single")
    .description('Flatten the whole project into one Confluence page (single process, no child spawn)')
    .argument('[dir]', 'Project root directory', '.')   // ← directory as last arg
    .requiredOption('--base-url <url>', 'Confluence base URL')
    .requiredOption('--basic-auth <u:p>', 'Basic authentication as user:pass')
    .requiredOption('-i, --page-id <id>', 'Existing Confluence page ID to update') // ← required now
    .option('--title <t>',               'Page title (defaults to current page title)')
    .option('--md <dir>',                'Topics directory (relative to [dir])',  'topics')
    .option('--images <dir>',            'Images directory (relative to [dir])',  'images')
    .addHelpText('after', ENV_HELP)
    .action(async (dirArg, opts) => {
      try {
        const rootDir = path.resolve(process.cwd(), dirArg ?? '.');

        // Detect project type in the provided directory
        let projectType = '';
        for (const cfgFile of PROJECT_CONFIG_FILES) {
          if (fs.existsSync(path.join(rootDir, cfgFile))) {
            projectType = cfgFile.split('.')[0];
            break;
          }
        }
        if (!projectType) {
          throw new Error('No project config found in the provided directory (authord.config.json | writerside.cfg)');
        }

        // Run validators (these commonly expect to read under CWD).
        // We temporarily chdir to rootDir to avoid any hidden PWD assumptions.
        const prevCwd = process.cwd();
        process.chdir(rootDir);
        try {
          if (projectType === 'authord') {
            await validateAuthordProject();
          } else {
            await validateWritersideProject();
          }
        } finally {
          process.chdir(prevCwd);
        }

        // Resolve paths relative to the provided root directory
        const mdDir  = path.resolve(rootDir, opts.md ?? 'topics');
        const imgDir = path.resolve(rootDir, opts.images ?? 'images');

        const runOpts: PublishSingleOptions = {
          rootDir,
          md: mdDir,
          images: imgDir,
          baseUrl: opts.baseUrl || process.env.CONF_BASE_URL || '',
          basicAuth: opts.basicAuth || process.env.CONF_BASIC_AUTH || '',
          pageId:  opts.pageId,       // required
          title:   opts.title,        // optional
        };

        console.log('🚀 Running single-page export...');
        await publishSingle(runOpts);
        console.log('✅ Done.');
      } catch (err: any) {
        console.error('❌ Fatal:', err?.message ?? err);
        // Let commander decide exit code; don’t force process.exit here.
        process.exitCode = 1;
      }
    });

  return cmd;
}
