// deno-lint-ignore-file no-explicit-any
// CLI subcommand: confluence-tree (Commander wired to ConfluenceTreePublisher)
// -----------------------------------------------------------------------------

import * as path from "node:path";
import { Command } from "npm:commander@^12";
import { ConfluenceCfg, asUrl, asPageId } from "@authord/render-core/core/shared/types.ts";
import { ConfluenceTreePublisher } from "./confluence_tree_publisher.ts";

/* ---------------------------------- Helpers --------------------------------- */

function parseBasicAuth(input: string): { username: string; password: string } {
  const idx = input.indexOf(":");
  if (idx <= 0) {
    throw new Error(
      `--basic-auth must be "user:pass". Got ${input}. (Bearer tokens are not yet supported)`,
    );
  }
  return { username: input.slice(0, idx), password: input.slice(idx + 1) };
}

function resolveUnderRoot(rootDir: string, p: string): string {
  const out = path.isAbsolute(p) ? p : path.resolve(rootDir, p);
  console.debug(`[authord:debug] resolveUnderRoot root=${rootDir} p=${p} -> ${out}`);
  return out;
}

async function detectCfg(rootDir: string, explicit?: string | null) {
  if (explicit) {
    const abs = resolveUnderRoot(rootDir, explicit);
    try {
      const st = await Deno.stat(abs);
      if (st.isFile && abs.toLowerCase().endsWith(".cfg")) return abs;
    } catch { /* ignore */ }
  }
  const candidate = path.resolve(rootDir, "writerside.cfg");
  try {
    const st = await Deno.stat(candidate);
    if (st.isFile) return candidate;
  } catch { /* ignore */ }
  return null;
}

/* ---------------------------------- Command --------------------------------- */

export function createConfluencePublishTreeCommand(): Command {
  const cmd = new Command("confluence-tree")
    .description("Publish a Writerside/Authord docset as a Confluence page tree.")
    .argument("[dir]", "Project root directory", ".")
    .requiredOption("--base-url <url>", "Confluence base URL (or set CONF_BASE_URL env)")
    .requiredOption(
      "--basic-auth <user:pass>",
      "Confluence credentials (or set CONF_BASIC_AUTH env). Format: user:pass",
    )
    .requiredOption("--page-id <id>", "Root Confluence page ID")
    .option("--default-title <title>", "Fallback title if a page name is empty", "Untitled")
    .option("--cfg <file>", "Explicit writerside.cfg (relative to [dir])")
    .option("--md <fileOrDir...>", "Markdown fallback: one or more *.md paths (relative to [dir])")
    .option("-i, --images <dir>", "Images directory, relative to [dir] (default: images)", "images")
    .option("--allow-remote-xsd", "Allow remote XSD fetch during validation")
    .addHelpText(
      "after",
      `
Env variables:
  CONF_BASE_URL      Confluence base URL (used if --base-url not provided)
  CONF_BASIC_AUTH    Credentials as "user:pass" (used if --basic-auth not provided)
  AUTHORD_IMAGE_DIR  Override images directory (same as --images)
  MMD_WIDTH          Mermaid width (px)
  MMD_HEIGHT         Mermaid height (px)
  MMD_SCALE          Mermaid scale
  MMD_BG             Mermaid background color (css color)
  MMD_THEME          Mermaid theme (default, dark, forest, neutral)
  MMD_CONFIG         Mermaid CLI config file path
`,
    )
    .action(async (dirArg: string, options: Record<string, string | string[] | boolean>) => {
      try {
        const rootDir = path.resolve(dirArg || ".");
        const baseUrlStr = String(options.baseUrl || Deno.env.get("CONF_BASE_URL") || "");
        const basicStr = String(options.basicAuth || Deno.env.get("CONF_BASIC_AUTH") || "");
        const pageIdStr = String(options.pageId || "");
        const defaultTitle = String(options.defaultTitle || "Untitled");

        if (!baseUrlStr) throw new Error("Missing --base-url (or CONF_BASE_URL)");
        if (!basicStr) throw new Error("Missing --basic-auth (or CONF_BASIC_AUTH)");
        if (!pageIdStr) throw new Error("Missing --page-id");
        const basicAuth = parseBasicAuth(basicStr);

        const cfgExplicit = (options.cfg as string | undefined) ?? null;
        const cfgPath = await detectCfg(rootDir, cfgExplicit);

        const imagesDir = resolveUnderRoot(
          rootDir,
          (options.images as string) || Deno.env.get("AUTHORD_IMAGE_DIR") || "images",
        );

        const mdOpt = options.md as string[] | string | undefined;
        const mdList = Array.isArray(mdOpt)
          ? mdOpt
          : (typeof mdOpt === "string" ? [mdOpt] : []);
        const mdPaths = mdList.map((p) => resolveUnderRoot(rootDir, p));

        const allowRemoteSchemaFetch = Boolean(options.allowRemoteXsd);

        const cfg: ConfluenceCfg = { baseUrl: asUrl(baseUrlStr), basicAuth };
        const result = await ConfluenceTreePublisher.build(cfg, imagesDir).execute({
          rootDir,
          cfgPath,
          mdPaths,
          imagesDir,
          rootPageId: asPageId(pageIdStr),
          defaultTitle,
          allowRemoteSchemaFetch,
        });

        const summary =
          `Published tree under page ${pageIdStr} [mode=${result.mode}] ` +
          `(pages=${result.pagesPublished}, updated=${result.pagesUpdated}, ` +
          `attachments=${result.attachmentsUploaded}).`;
        console.log(`[authord] ${summary}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[authord] Error: ${msg}`);
        if (typeof (globalThis as any).process !== "undefined") {
          (globalThis as any).process.exitCode = 1;
        } else {
          try {
            (Deno as any).exitCode = 1;
          } catch { /* ignore */ }
        }
      }
    });

  return cmd;
}
