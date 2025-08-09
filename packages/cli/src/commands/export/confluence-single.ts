import { Command }   from 'commander';
import path          from 'path';
import fs            from 'fs';

import { validateAuthordProject }     from '../../utils/validate-project';
import { validateWritersideProject }  from '../../utils/validate-writerside';
import { publishSingle, PublishSingleOptions } from '../../publish-single';

const PROJECT_CONFIG_FILES = ['authord.config.json', 'writerside.cfg'];

export default new Command('confluence-single')
  .description('Flatten the whole project into one Confluence page (single process, no child spawn)')
  .requiredOption('--base-url <url>', 'Confluence base URL')
  .requiredOption('--token <t>',      'API token (PAT/password)')
  .requiredOption('--space <KEY>',    'Space key (ignored if --page-id is given)')
  .option('--page-id, -i <ID>',       'Existing Confluence page-id to update')
  .option('--title <t>',              'Page title', 'Exported Documentation')
  .option('--md <dir>',               'Topics directory',  'topics')
  .option('--images <dir>',           'Images directory',  'images')
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
        baseUrl: opts.baseUrl,
        token: opts.token,
        space: opts.pageId ? undefined : opts.space, // space only needed if we’re creating
        pageId: opts.pageId,
        title: opts.title,
      };

      console.log('🚀 Running single-page export...');
      await publishSingle(runOpts);
      console.log('✅ Done.');
    } catch (err: any) {
      console.error('❌ Fatal:', err?.message ?? err);
      process.exitCode = 1;
    }
  });
