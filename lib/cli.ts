// Program root: wires subcommands and parses args.

import { Command } from "commander";
import { makeConfluenceSingle } from "./confluence-single.ts";

export async function main(argv: string[] = Deno.args) {
  const program = new Command()
    .name("authord")
    .description("Authord CLI tools")
    .addCommand(makeConfluenceSingle());

  await program.parseAsync(argv, { from: "user" });
}

if (import.meta.main) {
  // Run when invoked directly
  await main();
}