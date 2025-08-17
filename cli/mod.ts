#!/usr/bin/env -S deno run -A
import { Command } from "commander";
import { makeConfluenceSingle } from "./commands/confluence-single.ts";

const program = new Command()
  .name("authord")
  .description("Authord CLI")
  .enablePositionalOptions()
  .showHelpAfterError();

program.addCommand(makeConfluenceSingle());

await program.parseAsync(Deno.args, { from: "user" });

