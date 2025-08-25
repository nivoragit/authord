// Utilities to read local configuration for Writerside/Authord projects.
// - No network or CLI usage
// - Parses writerside.cfg (XML via fast-xml-parser) and authord.config.json
// - Produces absolute Markdown file paths that exist, in deterministic DFS order

import { XMLParser } from "fast-xml-parser";
import * as path from "node:path";

/** Simple file-exists check */
async function fileExists(p: string): Promise<boolean> {
  try {
    const st = await Deno.stat(p);
    return st.isFile;
  } catch {
    return false;
  }
}

function isMd(p: string): boolean {
  return path.extname(p).toLowerCase() === ".md";
}

function toAbsMd(candidate: string, mdDir: string): string {
  const abs = path.isAbsolute(candidate) ? candidate : path.resolve(mdDir, candidate);
  return abs;
}

function pushUnique(acc: string[], seen: Set<string>, item: string) {
  if (!seen.has(item)) {
    seen.add(item);
    acc.push(item);
  }
}

type AnyObj = Record<string, unknown>;

/** Recursively collect values that look like paths to `.tree` files */
function collectTreeRefs(obj: unknown, acc: string[] = []): string[] {
  if (Array.isArray(obj)) {
    for (const v of obj) collectTreeRefs(v, acc);
    return acc;
  }
  if (obj && typeof obj === "object") {
    for (const [, v] of Object.entries(obj as AnyObj)) {
      if (typeof v === "string" && /\.tree$/i.test(v.trim())) {
        acc.push(v.trim());
      }
      // Writerside structures vary; inspect nested structures as well.
      collectTreeRefs(v, acc);
    }
  }
  return acc;
}

/** Recursively collect any 'start-page' attribute values (strings) */
function collectStartPages(obj: unknown, acc: string[] = []): string[] {
  if (Array.isArray(obj)) {
    for (const v of obj) collectStartPages(v, acc);
    return acc;
  }
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as AnyObj)) {
      if (k === "start-page" && typeof v === "string") {
        acc.push(v);
      } else if (typeof v === "object" || Array.isArray(v)) {
        collectStartPages(v, acc);
      }
    }
  }
  return acc;
}

/** Find <topics dir="..."> in writerside.cfg (any nesting), return its dir string if present. */
function findTopicsDir(obj: unknown): string | undefined {
  if (!obj) return undefined;
  if (Array.isArray(obj)) {
    for (const v of obj) {
      const got = findTopicsDir(v);
      if (got) return got;
    }
    return undefined;
  }
  if (typeof obj === "object") {
    const o = obj as AnyObj;
    if (o.topics && typeof o.topics === "object" && typeof (o.topics as AnyObj).dir === "string") {
      return String((o.topics as AnyObj).dir);
    }
    for (const [, v] of Object.entries(o)) {
      const got = findTopicsDir(v);
      if (got) return got;
    }
  }
  return undefined;
}

/** DFS over Writerside/Authord 'toc-element' shapes; collects `topic` values */
function dfsToc(node: unknown, out: string[]) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const child of node) dfsToc(child, out);
    return;
  }
  if (typeof node !== "object") return;

  const obj = node as AnyObj;

  // Current node may itself be a toc-element object
  if (typeof obj.topic === "string") {
    out.push(obj.topic);
  }

  // Children may be under "toc-element" as object or array
  const children = obj["toc-element"] as unknown;
  if (children) {
    dfsToc(children, out);
  }

  // Some trees nest one extra level under a "toc" wrapper
  const toc = obj["toc"] as unknown;
  if (toc) {
    dfsToc(toc, out);
  }
}

/** Parse XML text with attributes preserved as plain keys */
function parseXml(xmlText: string): unknown {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    allowBooleanAttributes: true,
    trimValues: true,
  });
  return parser.parse(xmlText);
}

/** Read and traverse a Writerside .tree file; include optional start-page first, then DFS topics. */
async function readTreeFileCandidates(treePathAbs: string): Promise<string[]> {
  const candidates: string[] = [];
  const xml = await Deno.readTextFile(treePathAbs);
  const doc = parseXml(xml);
  // start-page may be declared on the root <instance-profile>
  const sps = collectStartPages(doc);
  if (sps.length) candidates.push(...sps);
  dfsToc(doc, candidates);
  return candidates;
}

/** Filter, resolve and dedupe a list of candidate topic paths */
async function normalizeCandidates(
  candidates: string[],
  mdDir: string,
): Promise<string[]> {
  const seen = new Set<string>();
  const abs: string[] = [];
  for (const raw of candidates) {
    if (typeof raw !== "string") continue;
    if (!isMd(raw)) continue;
    const p = toAbsMd(raw, mdDir);
    if (await fileExists(p)) {
      pushUnique(abs, seen, p);
    }
  }
  return abs;
}

/**
 * Parse writerside.cfg under `rootDir`, find referenced .tree files,
 * DFS traverse toc-elements, and include optional start-page if present (in cfg or .tree).
 * Returns absolute Markdown file paths that exist.
 */
export async function readWritersideOrder(
  rootDir: string,
  mdDir: string,
): Promise<string[]> {
  const cfgPath = path.resolve(rootDir, "writerside.cfg");
  if (!(await fileExists(cfgPath))) return [];

  const cfgXml = await Deno.readTextFile(cfgPath);
  const cfgDoc = parseXml(cfgXml);

  // Discover a <topics dir="...">, and prefer it as the base for resolving relative topics.
  const topicsDir = findTopicsDir(cfgDoc);
  const baseMdDir = topicsDir
    ? (path.isAbsolute(topicsDir) ? topicsDir : path.resolve(rootDir, topicsDir))
    : mdDir;

  // start-page could also live in cfg (rare); include if present
  const startPages = collectStartPages(cfgDoc);
  const treeRefs = collectTreeRefs(cfgDoc);

  const candidates: string[] = [];

  // Start pages from cfg first (if any)
  for (const sp of startPages) {
    candidates.push(sp);
  }

  // Traverse each .tree file in discovery order
  for (const treeRef of treeRefs) {
    const absTree = path.isAbsolute(treeRef)
      ? treeRef
      : path.resolve(rootDir, treeRef);
    if (!(await fileExists(absTree))) continue;
    const topics = await readTreeFileCandidates(absTree);
    candidates.push(...topics);
  }

  return await normalizeCandidates(candidates, baseMdDir);
}

/**
 * Parse authord.config.json under `rootDir`, collect instances[*].start-page
 * and DFS traverse their toc-elements. Returns absolute Markdown file paths
 * that exist.
 */
export async function readAuthordOrder(
  rootDir: string,
  mdDir: string,
): Promise<string[]> {
  const cfgPath = path.resolve(rootDir, "authord.config.json");
  if (!(await fileExists(cfgPath))) return [];

  const raw = await Deno.readTextFile(cfgPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const candidates: string[] = [];

  if (
    parsed &&
    typeof parsed === "object" &&
    Array.isArray((parsed as AnyObj).instances)
  ) {
    for (const inst of (parsed as AnyObj).instances as unknown[]) {
      if (!inst || typeof inst !== "object") continue;
      const i = inst as AnyObj;

      const sp = i["start-page"];
      if (typeof sp === "string") {
        candidates.push(sp);
      }

      // Support either { toc: {...} } or a root array/object of toc-element
      const tocRoot =
        (i.toc as unknown) ??
        (i["toc-element"] as unknown) ??
        null;

      if (tocRoot) {
        dfsToc(tocRoot, candidates);
      }
    }
  }

  return await normalizeCandidates(candidates, mdDir);
}
