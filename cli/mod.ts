#!/usr/bin/env -S deno run -A
import { Command } from "npm:commander@12";
import { makeConfluenceSingle } from "./commands/confluence-single.ts";

const program = new Command()
  .name("authord")
  .description("Authord CLI (Deno + commander)")
  .enablePositionalOptions()
  .showHelpAfterError();

program.addCommand(makeConfluenceSingle());

await program.parseAsync(Deno.args, { from: "user" });

