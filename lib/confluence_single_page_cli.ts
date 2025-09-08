// deno-lint-ignore-file no-explicit-any
// CLI subcommand: confluence-single (Commander wired to ConfluenceSinglePagePublisher)
// -----------------------------------------------------------------------------

import { Command } from "npm:commander@^12";
import * as path from "node:path";
import { MermaidRenderer } from "./adapters/diagram_renderer.ts";
import { IFileSystem } from "./ports/ports.ts";
import { Path, ConfluenceCfg, asUrl, asPageId } from "./utils/types.ts";
import { WritersideMarkdownTransformer } from "./writerside_markdown_transformer.ts";
import { ConfluenceSinglePagePublisher } from "./confluence_single_page_publisher.ts";
import { ConfluenceAttachmentRepository, ConfluencePageRepository, ConfluencePropertyStore } from "./confluence_api/confluence_repos.ts";

/* ------------------------------ Local FS adapter ----------------------------- */

class DenoFileSystem implements IFileSystem {
  async readText(p: Path): Promise<string> {
    const pp = p as unknown as string;
    return await Deno.readTextFile(pp);
  }
  async exists(p: Path): Promise<boolean> {
    const pp = p as unknown as string;
    try {
      const st = await Deno.stat(pp);
      const kind = st.isFile ? "file" : st.isDirectory ? "dir" : "other";
      console.debug(`[authord:debug] fs.exists -> ${pp} (true, ${kind})`);
      return true;
    } catch {
      console.debug(`[authord:debug] fs.exists -> ${pp} (false)`);
      return false;
    }
  }
  async glob(_pattern: string, _cwd?: Path): Promise<readonly Path[]> {
    return [];
  }
  async list(_dir: Path): Promise<readonly Path[]> {
    return [];
  }
}

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

/** Build ports and middleware from Confluence connection config. */
function buildMiddleware(cfg: ConfluenceCfg, imagesDir: string) {
  // Trigger Mermaid env defaults (width/height/theme) at startup
  const _renderer = new MermaidRenderer();

  const fs = new DenoFileSystem();
  const markdown = new WritersideMarkdownTransformer(imagesDir);

  const pageRepo = new ConfluencePageRepository(cfg);
  const attachRepo = new ConfluenceAttachmentRepository(cfg);
  const props = new ConfluencePropertyStore(cfg);

  const middleware = new ConfluenceSinglePagePublisher({
    fs,
    markdown,
    pageRepo,
    attachRepo,
    props,
  });

  return middleware;
}

/* ---------------------------------- Command --------------------------------- */

export function createConfluencePublishSinglePageCommand(): Command {
  const cmd = new Command("confluence-single")
    .description("Flatten and publish a Writerside/Authord docset to a single Confluence page.")
    .argument("[dir]", "Project root directory", ".")
    .requiredOption("--base-url <url>", "Confluence base URL (or set CONF_BASE_URL env)")
    .requiredOption(
      "--basic-auth <user:pass>",
      "Confluence credentials (or set CONF_BASIC_AUTH env). Format: user:pass",
    )
    .requiredOption("--page-id <id>", "Target Confluence page ID")
    .option("--title <title>", "Optional title override for the page")
    .option("--cfg <file>", "Explicit writerside.cfg (relative to [dir])")
    .option("--md <fileOrDir...>", "Markdown fallback: one or more *.md paths (relative to [dir])")
    .option("-i, --images <dir>", "Images directory, relative to [dir] (default: images)", "images")
    .option("--no-toc", "Do not insert a Confluence TOC macro at the top")
    .option("--heading-level <n>", "Section heading level for each page (1-6)", "2")
    .option("--separators", "Insert <hr/> between sections")
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
        const titleOpt = (options.title as string | undefined) ?? undefined;

        if (!baseUrlStr) throw new Error("Missing --base-url (or CONF_BASE_URL)");
        if (!basicStr) throw new Error("Missing --basic-auth (or CONF_BASIC_AUTH)");
        if (!pageIdStr) throw new Error("Missing --page-id");
        const basicAuth = parseBasicAuth(basicStr);

        const cfgExplicit = (options.cfg as string | undefined) ?? null;
        const cfgPath = await detectCfg(rootDir, cfgExplicit);

        // Images dir // todo set image dir by parsing config here
        const imagesDir = resolveUnderRoot(
          rootDir,
          (options.images as string) || Deno.env.get("AUTHORD_IMAGE_DIR") || "images",
        );

        // Markdown fallback paths (array)
        const mdOpt = options.md as string[] | string | undefined;
        const mdList = Array.isArray(mdOpt)
          ? mdOpt
          : (typeof mdOpt === "string" ? [mdOpt] : []);
        const mdPaths = mdList.map((p) => resolveUnderRoot(rootDir, p));

        // Composer options
        const insertToc = options.toc !== false;
        const sectionHeadingLevel = Math.min(6, Math.max(1, Number(options.headingLevel ?? 2))) as 1|2|3|4|5|6;
        const insertSeparators = Boolean(options.separators);
        const allowRemoteSchemaFetch = Boolean(options.allowRemoteXsd);

        const cfg: ConfluenceCfg = { baseUrl: asUrl(baseUrlStr), basicAuth };

        const middleware = buildMiddleware(cfg, imagesDir);
        const result = await middleware.execute({
          rootDir,
          cfgPath,
          mdPaths,
          imagesDir,
          pageId: asPageId(pageIdStr),
          title: titleOpt ?? "Documentation",
          composer: { insertToc, sectionHeadingLevel, insertSeparators },
          allowRemoteSchemaFetch,
        });

        const summary =
          `Published to page ${pageIdStr} [mode=${result.mode}] ` +
          `(updated=${result.updatedBody}, attachments=${result.uploadedAttachments}).`;
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
