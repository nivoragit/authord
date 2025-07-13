// src/commands/export/confluence.ts
import { Command } from 'commander';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';

import { validateProject } from '../../utils/validate-project';
import { validateWritersideProject } from '../../utils/validate-writerside';

// Configuration files to detect project type
const PROJECT_CONFIG_FILES = [
  'authord.config.json',
  'writerside.cfg',
];

export default new Command('confluence')
  .description('Publish project to Confluence')
  .option('--config <file>', 'Path to confluence.publish.json')
  .option('--token  <t>', 'API token (overrides JSON/env)')
  .action(async (opts) => {
    /* ───────────────── 1. Detect workspace type ───────────────── */
    const cwd = process.cwd();
    let projectType = '';

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

    /* ───────────────── 2. Validation ──────────────────────────── */
    if (projectType === 'authord') {
      await validateProject();                 // throws / exit(1) on failure
      console.log('✓ Authord project validated');
    } else {
      await validateWritersideProject();       // throws / exit(1) on failure
      console.log('✓ Writerside project validated');
    }

    /* ───────────────── 3. Spawn publisher ─────────────────────── */
    const script = path.resolve(__dirname, '../../../src/scripts/run-publish.js');
    const confluenceSettings = path.join(__dirname, '../../../src/scripts/confluence.publish.json');
    const args = [
      script,
      '--config', opts.config ?? confluenceSettings,
      ...(opts.token ? ['--token', opts.token] : []),
      '--project-type', projectType,
    ];

    const child = spawn('node', args, { stdio: 'inherit' });

    child.on('error', err => {
      console.error('Failed to start run-publish:', err);
      process.exit(1);
    });
    child.on('exit', code => process.exit(code ?? 0));
  });