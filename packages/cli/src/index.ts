#!/usr/bin/env node
import { Command } from 'commander';
import confluenceCmd from './commands/export/confluence';
import confluenceSingle from './commands/export/confluence-single';

const program = new Command();
const exportCmd = new Command('export')
  .description('Export project to Confluence (uses your JSON config)')
  // .addCommand(htmlCommand)
  .addCommand(confluenceCmd)
  .addCommand(confluenceSingle);  //single-page; 

program.addCommand(exportCmd);
program.parse(process.argv);
