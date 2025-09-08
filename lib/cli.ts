// Program root: wires subcommands and parses args (Deno-friendly).
// Uses npm:commander so `deno run -A lib/cli.ts ...` works without import maps.

import { Command } from "npm:commander@^12";
import { createConfluencePublishSinglePageCommand } from "./confluence_single_page_cli.ts";

export async function main(argv: string[] = Deno.args) {
  console.debug(`[authord:debug] cli.ts argv=${JSON.stringify(argv)}`);

  const program = new Command()
    .name("authord")
    .description("Authord CLI tools")
    .addCommand(createConfluencePublishSinglePageCommand());

  await program.parseAsync(argv, { from: "user" });
}

if (import.meta.main) {
  await main();
}
