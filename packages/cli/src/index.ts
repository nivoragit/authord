#!/usr/bin/env node
import { Command } from 'commander';
import confluenceSingle from './commands/export/confluence-single';

const program = new Command();
program.addCommand(confluenceSingle);
program.parse(process.argv);
