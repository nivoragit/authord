// src/commands/export/confluence-single.ts
import { Command } from 'commander';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';

import { validateProject } from '../../utils/validate-project';
import { validateWritersideProject } from '../../utils/validate-writerside';

const PROJECT_CONFIG_FILES = ['authord.config.json', 'writerside.cfg'];

export default new Command('confluence-single')
  .description('Publish the entire project to ONE Confluence page')
  .option('--config <file>', 'Path to confluence.publish.json')
  .option('--token  <t>',   'API token (overrides JSON/env)')
  .option('--title  <t>',   'Page title (defaults "Exported Documentation")')
  .action(async (opts) => {
    const cwd = process.cwd();
    let projectType = '';

    // 1️⃣ detect authord vs writerside
    for (const cfgFile of PROJECT_CONFIG_FILES) {
      if (fs.existsSync(path.join(cwd, cfgFile))) {
        projectType = cfgFile.split('.')[0];
        break;
      }
    }
    if (!projectType) {
      console.error(
        '❌ No project config found. Expected one of:\n' +
        PROJECT_CONFIG_FILES.map(f => `  • ${f}`).join('\n')
      );
      process.exit(1);
    }

    // 2️⃣ validate
    if (projectType === 'authord') {
      await validateProject();
      console.log('✓ Authord project validated');
    } else {
      await validateWritersideProject();
      console.log('✓ Writerside project validated');
    }

    // 3️⃣ spawn the single-page wrapper
    const script       = path.resolve(__dirname, '../../../src/scripts/run-publish-single.js');
    const defaultCfg   = path.resolve(__dirname, '../../../src/scripts/confluence.publish.json');
    const args: string[] = [
      script,
      '--config', opts.config ?? defaultCfg,
      ...(opts.token ? ['--token', opts.token] : []),
      ...(opts.title ? ['--title', opts.title] : []),
      '--project-type', projectType,
    ];

    console.log(`\n> node ${args.map(a => (/ /.test(a) ? `"${a}"` : a)).join(' ')}\n`);
    const child = spawn('node', args, { stdio: 'inherit' });
    child.on('error', err => {
      console.error('Failed to start run-publish-single:', err);
      process.exit(1);
    });
    child.on('exit', code => process.exit(code ?? 0));
  });
