#!/usr/bin/env -S deno run -A
// cli/mod.ts

import { Command } from "npm:commander@12";
import * as fs from "node:fs";
import * as path from "node:path";
import { getEnv, exit } from "../utils/env.ts";
import { publishSingle } from "../publisher/publish-single.ts";
import { PublishSingleOptions } from "../utils-project/types.ts";
import { validateAuthordProject } from "../utils-project/validate-project.ts";
import { validateWritersideProject } from "../utils-project/validate-writerside.ts";


const program = new Command().name("authord").description("Authord CLI (Deno + commander)");

program
  .command("confluence-single")
  .description("Flatten project into a single Confluence page")
  .requiredOption("--base-url <url>", "Confluence base URL")
  .requiredOption("--token <t>", "API token (PAT/password)")
  .requiredOption("--space <KEY>", "Space key (ignored if --page-id is given)")
  .option("--page-id, -i <ID>", "Existing Confluence page-id to update")
  .option("--title <t>", "Page title", "Exported Documentation")
  .option("--md <dir>", "Topics directory", "topics")
  .option("--images <dir>", "Images directory", "images")
  .action(async (opts) => {
    try {
      const cwd = Deno.cwd();
      const isWriterside = fs.existsSync(path.join(cwd, "writerside.cfg"));

      if (isWriterside) await validateWritersideProject(cwd);
      else await validateAuthordProject(cwd);

      const runOpts: PublishSingleOptions = {
        md: opts.md,
        images: opts.images,
        baseUrl: opts.baseUrl,
        token: opts.token ?? getEnv("CONF_TOKEN"),
        space: opts.pageId ? undefined : opts.space,
        pageId: opts.pageId,
        title: opts.title,
      };

      await publishSingle(runOpts);
      console.log("✅ Done.");
    } catch (e: any) {
      console.error("❌", e?.message ?? e);
      exit(1);
    }
    exit(0);
  });

await program.parseAsync(Deno.args);
