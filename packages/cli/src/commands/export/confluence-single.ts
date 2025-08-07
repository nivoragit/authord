import { Command } from 'commander';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';

import { validateAuthordProject } from '../../utils/validate-project';
import { validateWritersideProject } from '../../utils/validate-writerside';

const PROJECT_CONFIG_FILES = ['authord.config.json', 'writerside.cfg'];

export default new Command('confluence-single')
  .description('Flatten the whole project into one Confluence page')
  .requiredOption('--base-url <url>', 'Confluence base URL')
  .requiredOption('--token <t>',      'API token (PAT/password)')
  .requiredOption('--space <KEY>',    'Space key')
  .option('--title <t>',              'Page title', 'Exported Documentation')
  .option('--md <dir>',               'Topics directory',  'topics')
  .option('--images <dir>',           'Images directory',  'images')
  .action(async (opts) => {
    const cwd = process.cwd();
    let projectType = '';

    for (const cfgFile of PROJECT_CONFIG_FILES)
      if (fs.existsSync(path.join(cwd, cfgFile))) { projectType = cfgFile.split('.')[0]; break; }

    if (!projectType) {
      console.error('❌ No project config found (authord.config.json | writerside.cfg)'); process.exit(1);
    }

    projectType === 'authord'
      ? await validateAuthordProject()
      : await validateWritersideProject();

    const publishScript = path.resolve(__dirname, '../../publish-single.js');
    const args = [
      'ts-node', publishScript,
      '--md',     opts.md,
      '--images', opts.images,
      '--space',  opts.space,
      '--title',  opts.title,
      '--base-url', opts.baseUrl,
      '--token',    opts.token,
    ];

    console.log(`\n> npx ${args.join(' ')}\n`);
    const child = spawn('npx', args, { stdio: 'inherit' });
    child.on('exit', (code) => process.exit(code ?? 0));
  });
