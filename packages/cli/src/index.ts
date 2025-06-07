#!/usr/bin/env node

import { Command } from 'commander';
import { lintCommand } from './commands/lint';
import htmlCommand from './commands/export/html';

const program = new Command();

program
  .command('lint')
  .description('Validate project configuration and file structure')
  .action(lintCommand);

// ─── export html ───────────────────────────────────────────────────────────
const exportCmd = new Command('export')
  .description('Export project content');
exportCmd.addCommand(htmlCommand);
program.addCommand(exportCmd);

// ─── run ───────────────────────────────────────────────────────────────────
program.parse(process.argv);






// #!/usr/bin/env node

// import { Command } from 'commander';
// import { lintCommand } from './commands/lint';
// import htmlCommand from './commands/export/html';
// import { render_all } from '@authord/renderer-html';

// const program = new Command();

// program
//   .command('lint')
//   .description('Validate project configuration and file structure')
//   .action(lintCommand);

// const exportCmd = new Command('export')
//   .description('Export project content')
//   .addCommand(htmlCommand);
// program.addCommand(exportCmd);

// // ─── render-all ──────────────────────────────────────────────────────────────
// program
//   .command('render-all [srcDir] [outFile]')
//   .description('Render **every** .md file under a folder into a single HTML page')
//   .option('-i, --inline', 'Inline assets as data URIs')
//   .action(async (srcDir = '.', outFile = './build/all.html', opts) => {
//     // Rebuild process.argv so render_all() picks up our args correctly
//     process.argv = [
//       process.argv[0],
//       process.argv[1],
//       srcDir,
//       outFile,
//       opts.inline ? '--inline' : ''
//     ].filter(Boolean);
//     await render_all();
//   });

// program.parse(process.argv);
