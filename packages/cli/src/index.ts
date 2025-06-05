import { Command } from 'commander';
import { lintCommand } from './commands/lint';


const program = new Command();

program
  .command('lint')
  .description('Validate project configuration and file structure')
  .action(lintCommand);

program.parse(process.argv);