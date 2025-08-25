// CLI subcommand: confluence-single
// Binds env/flags, wires adapters, and invokes the core use case.
// No business logic here beyond option normalization and dependency wiring.

import { Command } from "commander";
import * as path from "node:path";
import {
  asPageId,
  asPath,
  asUrl,
  type ConfluenceCfg,
  type PublishSingleOptions,
  type Path,
} from "./utils/types.ts";
import { OrderingResolver } from "./order/ordering-resolver.ts";
import { WritersideMarkdownTransformer } from "./writerside-markdown-transformer.ts";
import { MermaidRenderer } from "./adapters/diagram-renderer.ts";
import {
  ConfluenceAttachmentRepository,
  ConfluencePageRepository,
  ConfluencePropertyStore,
} from "./adapters/confluence-repos.ts";
import { publishSingle, setPublishDeps, type PublishDeps } from "./publish-single.ts";
import type { IFileSystem } from "./ports/ports.ts";

// ---- Local FS adapter (only what's used by the use case)
class DenoFileSystem implements IFileSystem {
  async readText(p: Path): Promise<string> {
    return await Deno.readTextFile(p as unknown as string);
  }
  async exists(p: Path): Promise<boolean> {
    try {
      await Deno.stat(p as unknown as string);
      return true;
    } catch {
      return false;
    }
  }
  async glob(_pattern: string, _cwd?: Path): Promise<readonly Path[]> {
    // Not needed by current use case; return empty.
    return [];
  }
  async list(_dir: Path): Promise<readonly Path[]> {
    // Not needed by current use case; return empty.
    return [];
  }
}

// ---- Helpers

function parseBasicAuth(input: string): { username: string; password: string } {
  // Accept "user:pass"
  const idx = input.indexOf(":");
  if (idx <= 0) {
    throw new Error(
      `--basic-auth must be "user:pass". Got ${input}. (Bearer tokens are not yet supported)`,
    );
  }
  return { username: input.slice(0, idx), password: input.slice(idx + 1) };
}

/** Resolve a possibly-relative path under the project root. */
function resolveUnderRoot(rootDir: string, p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(rootDir, p);
}

async function resolveEntrypointFile(mdArg: string): Promise<string> {
  // If it's a file, return as-is. If it's a directory, try common names.
  try {
    const st = await Deno.stat(mdArg);
    if (st.isFile) return mdArg;
  } catch {
    // continue as dir lookup
  }
  const candidates = [
    path.join(mdArg, "start.md"),
    path.join(mdArg, "index.md"),
    path.join(mdArg, "README.md"),
  ];
  for (const p of candidates) {
    try {
      const st = await Deno.stat(p);
      if (st.isFile) return p;
    } catch {
      // try next
    }
  }
  // Fallback: first .md under mdArg (shallow)
  try {
    for await (const entry of Deno.readDir(mdArg)) {
      if (entry.isFile && entry.name.toLowerCase().endsWith(".md")) {
        return path.join(mdArg, entry.name);
      }
    }
  } catch {
    // ignore
  }
  // Give up; return what we got (will error later if missing)
  return mdArg;
}

/** Build concrete adapters (deps) from options. */
function buildDefaultDeps(cfg: ConfluenceCfg): PublishDeps {
  const fs = new DenoFileSystem();
  const ordering = new OrderingResolver();
  const transformer = new WritersideMarkdownTransformer();
  // instantiate to trigger env-based defaults
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _renderer = new MermaidRenderer();

  const pageRepo = new ConfluencePageRepository(cfg);
  const attachRepo = new ConfluenceAttachmentRepository(cfg);
  const props = new ConfluencePropertyStore(cfg);

  return { fs, ordering, transformer, pageRepo, attachRepo, props };
}

/** Public helper so tests can run the action with mocked deps if desired. */
export async function runConfluenceSingle(
  opts: PublishSingleOptions,
  deps?: PublishDeps,
): Promise<void> {
  const cfg: ConfluenceCfg = {
    baseUrl: opts.baseUrl,
    basicAuth: opts.basicAuth,
  };
  const concrete = deps ?? buildDefaultDeps(cfg);
  setPublishDeps(concrete);
  await publishSingle(opts);
}

/** Construct the commander Command for this subcommand. */
export function makeConfluenceSingle(): Command {
  const cmd = new Command("confluence-single")
    .description(
      "Flatten a Writerside/Authord docs set and publish it to a single Confluence page.",
    )
    .argument("[dir]", "Project root directory", ".")
    .requiredOption("--base-url <url>", "Confluence base URL (or set CONF_BASE_URL env)")
    .requiredOption(
      "--basic-auth <user:pass>",
      "Confluence credentials (or set CONF_BASIC_AUTH env). Format: user:pass",
    )
    .requiredOption("--page-id <id>", "Target Confluence page ID")
    .option("--title <title>", "Optional title override for the page")
    .option("--md <fileOrDir>", "Entry Markdown file or directory, relative to [dir] (default: topics)", "topics")
    .option("-i, --images <dir>", "Images directory, relative to [dir] (default: images)", "images")
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

Notes:
  - Bearer tokens are not yet supported in this build; use basic auth (user:pass).
`,
    )
    .action(async (dirArg: string, options: Record<string, string>) => {
      try {
        const rootDir = path.resolve(dirArg || ".");
        const baseUrlStr = options.baseUrl || Deno.env.get("CONF_BASE_URL");
        const basicStr = options.basicAuth || Deno.env.get("CONF_BASIC_AUTH");
        const pageIdStr = options.pageId;

        // Resolve md/images relative to the provided [dir] root
        const mdArg = options.md || "topics";
        const mdPath = await resolveEntrypointFile(
          resolveUnderRoot(rootDir, mdArg),
        );
        const imagesDir = resolveUnderRoot(
          rootDir,
          options.images || Deno.env.get("AUTHORD_IMAGE_DIR") || "images",
        );

        if (!baseUrlStr) throw new Error("Missing --base-url (or CONF_BASE_URL)");
        if (!basicStr) throw new Error("Missing --basic-auth (or CONF_BASIC_AUTH)");
        if (!pageIdStr) throw new Error("Missing --page-id");

        const ba = parseBasicAuth(basicStr);

        const psOpts: PublishSingleOptions = {
          rootDir: asPath(rootDir),
          md: asPath(mdPath),
          images: asPath(imagesDir),
          baseUrl: asUrl(baseUrlStr),
          basicAuth: ba,
          pageId: asPageId(pageIdStr),
          title: options.title,
        };

        await runConfluenceSingle(psOpts);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[authord] Error: ${msg}`);
        // Do not hard exit (better for tests); indicate failure
        if (typeof (globalThis as any).process !== "undefined") {
          (globalThis as any).process.exitCode = 1;
        } else {
          try {
            (Deno as any).exitCode = 1;
          } catch {
            // ignore
          }
        }
      }
    });

  return cmd;
}
