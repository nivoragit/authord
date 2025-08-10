import { Command }   from 'commander';
import path          from 'path';
import fs            from 'fs';

import { validateAuthordProject }     from '../../utils/validate-project';
import { validateWritersideProject }  from '../../utils/validate-writerside';
import { publishSingle }              from '../../publish-single';
import { PublishSingleOptions }       from '../../utils/types';

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
    CONF_TOKEN                    ${envOrDef('CONF_TOKEN', '(unset)')}
      Alternative to --token.

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

  PlantUML (optional)
    AUTHORD_PLANTUML              ${envOrDef('AUTHORD_PLANTUML', 'on')}
      Disable PlantUML rendering with: off,false,0.
    PLANTUML_JAR                  ${envOrDef('PLANTUML_JAR', '~/bin/plantuml.jar | vendor/plantuml.jar | env')}
      Explicit path to plantuml.jar. Search order if unset:
      $PLANTUML_JAR → ./vendor/plantuml.jar → ~/bin/plantuml.jar

  Debug / Verbose logging
    AUTHORD_DEBUG                 ${envOrDef('AUTHORD_DEBUG', '0')}
      Enable extra debug logs during processing.
    AUTHORD_CHROME_VERBOSE        ${envOrDef('AUTHORD_CHROME_VERBOSE', '0')}
      Passes verbose flags to Chromium launch for Puppeteer.

Notes
  • CLI fallback (mmdc) is attempted ONLY when AUTHORD_MERMAID_FALLBACK_CLI is truthy.
    Requires the "mmdc" binary available in PATH or node_modules/.bin.
  • Most efficient: use JS API with Puppeteer as a direct dependency; the CLI is only a safety net.
  • Headless Chromium launches with --no-sandbox and --disable-setuid-sandbox by default (good for CI/DC).
  • PlantUML requires a Java runtime and a valid plantuml.jar. If disabled or missing,
    PlantUML code blocks are left unchanged.
  • Generated images are cached and linked under AUTHORD_IMAGE_DIR; attachments are uploaded as needed.
`;



/* ─────────────────────────────────────────────────────────────────────────── */

export default new Command('confluence-single')
  .description('Flatten the whole project into one Confluence page (single process, no child spawn)')
  .requiredOption('--base-url <url>', 'Confluence base URL')
  .requiredOption('--token <t>',      'API token (PAT/password)')
  .requiredOption('--space <KEY>',    'Space key (ignored if --page-id is given)')
  .option('--page-id, -i <ID>',       'Existing Confluence page-id to update')
  .option('--title <t>',              'Page title', 'Exported Documentation')
  .option('--md <dir>',               'Topics directory',  'topics')
  .option('--images <dir>',           'Images directory',  'images')
  .addHelpText('after', ENV_HELP) // ← add env docs to --help
  .action(async (opts) => {
    try {
      const cwd = process.cwd();
      let projectType = '';

      for (const cfgFile of PROJECT_CONFIG_FILES) {
        if (fs.existsSync(path.join(cwd, cfgFile))) {
          projectType = cfgFile.split('.')[0];
          break;
        }
      }

      if (!projectType) {
        throw new Error('No project config found (authord.config.json | writerside.cfg)');
      }

      projectType === 'authord'
        ? await validateAuthordProject()
        : await validateWritersideProject();

      // Resolve paths relative to CWD for a predictable UX
      const mdDir  = path.resolve(cwd, opts.md ?? 'topics');
      const imgDir = path.resolve(cwd, opts.images ?? 'images');

      const runOpts: PublishSingleOptions = {
        md: mdDir,
        images: imgDir,
        baseUrl: opts.baseUrl || process.env.CONF_BASE_URL || '',
        token:   opts.token   || process.env.CONF_TOKEN     || '',
        space:   opts.pageId ? undefined : opts.space, // space only needed if we’re creating
        pageId:  opts.pageId,
        title:   opts.title,
      };

      console.log('🚀 Running single-page export...');
      await publishSingle(runOpts);
      console.log('✅ Done.');
    } catch (err: any) {
      console.error('❌ Fatal:', err?.message ?? err);
      process.exitCode = 1;
    }
    process.exit(0);
  });
