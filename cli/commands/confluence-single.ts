import { Command } from "npm:commander@12";
import * as path from "node:path";
import * as fs from "node:fs";
import process from "node:process";

import { publishSingle } from "../../publisher/publish-single.ts";
import type { PublishSingleOptions } from "../../utils-project/types.ts";
import { validateAuthordProject } from "../../utils-project/validate-project.ts";
import { validateWritersideProject } from "../../utils-project/validate-writerside.ts";

const PROJECT_CONFIG_FILES = ["authord.config.json", "writerside.cfg"];

function envOrDef(name: string, def: string) {
  const v = process.env[name];
  return v ? `${v} (current)` : `${def} (default)`;
}

const ENV_HELP = `
Environment variables

  Confluence auth/config (alternatives to flags)
    CONF_BASE_URL                 ${envOrDef("CONF_BASE_URL", "(unset)")}
      Alternative to --base-url.
    CONF_TOKEN                    ${envOrDef("CONF_TOKEN", "(unset)")}
      Alternative to --token.

  Images (attachments)
    AUTHORD_IMAGE_DIR             ${envOrDef("AUTHORD_IMAGE_DIR", "images")}
      Directory where generated PNGs are linked/copied for Confluence attachments.

  Mermaid rendering (JS API; Puppeteer-backed)
    AUTHORD_MERMAID_FALLBACK_CLI  ${envOrDef("AUTHORD_MERMAID_FALLBACK_CLI", "0")}
      Enable CLI fallback if JS API fails. Accepted truthy values: 1,true,on,yes.
    MMD_WIDTH                     ${envOrDef("MMD_WIDTH",  "800")}
    MMD_HEIGHT                    ${envOrDef("MMD_HEIGHT", "600")}
    MMD_SCALE                     ${envOrDef("MMD_SCALE",  "1")}
    MMD_BG                        ${envOrDef("MMD_BG",     "white")}

  PlantUML (optional)
    AUTHORD_PLANTUML              ${envOrDef("AUTHORD_PLANTUML", "on")}
      Disable PlantUML rendering with: off,false,0.
    PLANTUML_JAR                  ${envOrDef("PLANTUML_JAR", "~/bin/plantuml.jar | vendor/plantuml.jar | env")}

  Debug / Verbose logging
    AUTHORD_DEBUG                 ${envOrDef("AUTHORD_DEBUG", "0")}
    AUTHORD_CHROME_VERBOSE        ${envOrDef("AUTHORD_CHROME_VERBOSE", "0")}
`;

export function makeConfluenceSingle(): Command {
  const cmd = new Command("confluence-single")
    .description("Flatten the whole project into one Confluence page (single process, no child spawn)")
    .requiredOption("--base-url <url>", "Confluence base URL")
    .requiredOption("--token <t>",      "API token (PAT/password)")
    // Make --space optional in parsing; we’ll validate it against page-id in the action.
    .option("-s, --space <KEY>",        "Space key (ignored if --page-id is given)")
    .option("-i, --page-id <ID>",       "Existing Confluence page-id to update")
    .option("--title <t>",              "Page title", "Exported Documentation")
    .option("--md <dir>",               "Topics directory",  "topics")
    .option("--images <dir>",           "Images directory",  "images")
    .addHelpText("after", ENV_HELP)
    .action(async (opts) => {
      try {
        // Validate space vs page-id
        if (!opts.pageId && !opts.space) {
          throw new Error("Either --space or --page-id is required (provide --space for creating a page; --page-id for updating).");
        }

        const cwd = process.cwd();
        let projectType = "";

        for (const cfgFile of PROJECT_CONFIG_FILES) {
          if (fs.existsSync(path.join(cwd, cfgFile))) {
            projectType = cfgFile.split(".")[0];
            break;
          }
        }
        if (!projectType) {
          throw new Error("No project config found (authord.config.json | writerside.cfg)");
        }

        if (projectType === "authord") {
          await validateAuthordProject();
        } else {
          await validateWritersideProject();
        }

        const mdDir  = path.resolve(cwd, opts.md ?? "topics");
        const imgDir = path.resolve(cwd, opts.images ?? "images");

        const runOpts: PublishSingleOptions = {
          md: mdDir,
          images: imgDir,
          baseUrl: opts.baseUrl || process.env.CONF_BASE_URL || "",
          token:   opts.token   || process.env.CONF_TOKEN     || "",
          space:   opts.pageId ? undefined : opts.space,
          pageId:  opts.pageId,
          title:   opts.title,
        };

        console.log("🚀 Running single-page export...");
        await publishSingle(runOpts);
        console.log("✅ Done.");
      } catch (err: any) {
        console.error("❌ Fatal:", err?.message ?? err);
        // Let commander/Deno decide exit code; don’t force process.exit here.
        process.exitCode = 1;
      }
    });

  return cmd;
}
