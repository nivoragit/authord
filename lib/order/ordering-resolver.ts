// Deterministic Markdown ordering, preferring Writerside/Authord configs and
// falling back to an alphabetical recursive scan. Pure FS logic.
// Adheres to the IOrderingResolver port.

import * as path from "node:path";
import { readAuthordOrder, readWritersideOrder } from "../utils/readConfig.ts";
import type { IOrderingResolver } from "../ports/ports.ts";
import { asPath, type Path } from "../utils/types.ts";

/** Return all .md files under mdDir (recursive), as absolute paths, alpha-sorted by relative path. */
async function listAllMarkdown(mdDir: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string) {
    let iter: AsyncIterable<Deno.DirEntry>;
    try {
      iter = Deno.readDir(dir);
    } catch {
      // Directory may have been removed between test setup and scan; skip
      return;
    }

    for await (const entry of iter) {
      const abs = path.resolve(dir, entry.name);
      if (entry.isDirectory) {
        await walk(abs);
      } else if (entry.isFile) {
        // Only include exact lowercase ".md" extension (README.MD excluded)
        if (path.extname(entry.name) === ".md") {
          results.push(abs);
        }
      } else if (entry.isSymlink) {
        // Avoid following symlinks to keep scan deterministic and safe
        continue;
      }
    }
  }

  // If mdDir vanished (race in tests), just return empty
  try {
    const st = await Deno.stat(mdDir);
    if (!st.isDirectory) return [];
  } catch {
    return [];
  }

  await walk(mdDir);

  // Sort by relative path for deterministic ordering across machines/OS
  results.sort((a, b) => {
    const ra = path.relative(mdDir, a);
    const rb = path.relative(mdDir, b);
    return ra.localeCompare(rb);
  });
  return results;
}

/** Deduplicate while preserving first occurrence order. */
function dedupePreserve<T>(list: readonly T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const item of list) {
    if (!seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

/**
 * Compute the resolved markdown order:
 * 1) Prefer Writerside order (if any),
 * 2) else Authord order (if any),
 * 3) else alphabetical recursive scan of mdDir.
 * Always append "orphans" (files found in mdDir but not in the primary order),
 * in alphabetical order. Logs the number of appended orphans.
 */
export async function resolveMarkdownOrder(
  rootDir: string,
  mdDir: string,
): Promise<string[]> {
  // Primary (from config) if available
  const ws = await readWritersideOrder(rootDir, mdDir);
  const au = ws.length === 0 ? await readAuthordOrder(rootDir, mdDir) : [];
  const primary = dedupePreserve(ws.length > 0 ? ws : au);

  // Discover all md files under mdDir
  const all = await listAllMarkdown(mdDir);

  if (primary.length === 0) {
    // No config-based order; return alphabetical full list
    console.info(`[authord] appended 0 orphan markdown files`);
    return all;
  }

  // Append orphans (present in mdDir but not in primary)
  const primarySet = new Set(primary);
  const orphans = all.filter((p) => !primarySet.has(p));
  return [...primary, ...orphans];
}

/** Port adapter which just delegates to resolveMarkdownOrder */
export class OrderingResolver implements IOrderingResolver {
  async resolve(rootDir: Path): Promise<readonly Path[]> {
    // In this layer we treat Path as a branded string and just pass through.
    // Callers are responsible for supplying mdDir (the markdown root).
    // To keep the port minimal, we assume mdDir === rootDir by default.
    const mdDir = rootDir as unknown as string;
    const list = await resolveMarkdownOrder(mdDir, mdDir);
    const branded: Path[] = list.map((p) => asPath(p));
    return branded;
  }
}
