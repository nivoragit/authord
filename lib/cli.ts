// Program root: wires subcommands and parses args (Deno-friendly).
// Uses npm:commander so `deno run -A lib/cli.ts ...` works without import maps.

import { Command } from "npm:commander@^12";
import { createConfluencePublishSinglePageCommand } from "./confluence_single_page_cli.ts";
import { createConfluencePublishTreeCommand } from "./confluence_tree_cli.ts";
import { setRenderRuntime } from "@authord/render-core";
import { createDenoRuntime } from "@authord/render-core/runtime-deno";

export async function main(argv: string[] = Deno.args) {
  console.debug(`[authord:debug] cli.ts argv=${JSON.stringify(argv)}`);
  setRenderRuntime(createDenoRuntime());

  const program = new Command()
    .name("authord")
    .description("Authord CLI tools")
    .addCommand(createConfluencePublishSinglePageCommand())
    .addCommand(createConfluencePublishTreeCommand());

  await program.parseAsync(argv, { from: "user" });
}

if (import.meta.main) {
  await main();
}
