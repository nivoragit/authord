/**********************************************************************
 * writerside-markdown-transformer.ts
 * Confluence DC/Server — strict-XHTML + auto-copied diagrams
 *
 * Mermaid cascade (with persistent debug log):
 *   (1) JS API (puppeteer direct dep) →
 *   (2) JS API (puppeteer transitively via @mermaid-js/mermaid-cli) →
 *   (3) CLI fallback (mmdc) only if AUTHORD_MERMAID_FALLBACK_CLI=1
 *
 * PlantUML optional; if jar missing/disabled → keep code block
 * Caches PNGs, links into IMAGE_DIR so imageSize() works
 * Clean shutdown: closes Puppeteer on exit/signals/errors
 * CommonJS-compatible (no import.meta)
 *********************************************************************/

import { MarkdownTransformer } from '@atlaskit/editor-markdown-transformer';
import { defaultSchema }       from '@atlaskit/adf-schema/schema-default';
import type { Schema }         from 'prosemirror-model';

import { unified }             from 'unified';
import remarkParse             from 'remark-parse';
import remarkDirective         from 'remark-directive';
import remarkGfm               from 'remark-gfm';
import remarkStringify         from 'remark-stringify';
import remarkRehype            from 'remark-rehype';
import rehypeStringify         from 'rehype-stringify';
import rehypeRaw               from 'rehype-raw';

import type { Parent, Node as UnistNode } from 'unist';
import type { Image, Code }               from 'mdast';

import { execFileSync }   from 'child_process';
import * as fs            from 'fs';
import * as fsp           from 'fs/promises';
import * as path          from 'path';
import { tmpdir, homedir }from 'os';
import { imageSize }      from 'image-size';
import { createRequire }  from 'module';

/* ════════════════  DEBUG HELPERS  ════════════════ */

const DEBUG = /^(1|true|on|yes)$/i.test(String(process.env.AUTHORD_DEBUG ?? ''));
const dbg   = (...a: any[]) => { if (DEBUG) console.log('[authord:debug]', ...a); };
const warn  = (...a: any[]) => console.warn('[authord]', ...a);

function readPkg(name: string) {
  try {
    const req = createRequire(__filename);
    const pkgPath = req.resolve(`${name}/package.json`);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return { version: pkg.version, path: pkgPath };
  } catch { return null; }
}

/* ───────── Persistent Mermaid debug log ───────── */
const WORK_DIR   = path.join(tmpdir(), 'writerside-diagrams');
fs.mkdirSync(WORK_DIR, { recursive: true });
const MERMAID_LOG_FILE = path.join(WORK_DIR, 'mermaid-debug.log');

function appendMermaidLog(line: string) {
  try {
    const ts = new Date().toISOString();
    fs.appendFileSync(MERMAID_LOG_FILE, `[${ts}] ${line}\n`);
  } catch { /* ignore */ }
}

function tailMermaidLog(maxLines = 40): string[] {
  try {
    const data = fs.readFileSync(MERMAID_LOG_FILE, 'utf8');
    const lines = data.trimEnd().split(/\r?\n/);
    return lines.slice(-maxLines);
  } catch { return []; }
}

function logEnvOnce() {
  if (!DEBUG) return;
  const lines = Number(process.env.AUTHORD_MERMAID_LOG_LINES ?? 20);
  const prev = tailMermaidLog(Math.max(1, Math.min(200, lines)));
  dbg('node', process.version, process.platform, process.arch);
  dbg('env', {
    AUTHORD_HEADLESS: process.env.AUTHORD_HEADLESS,
    AUTHORD_MERMAID_FALLBACK_CLI: process.env.AUTHORD_MERMAID_FALLBACK_CLI,
    PUPPETEER_EXECUTABLE_PATH: process.env.PUPPETEER_EXECUTABLE_PATH,
    MMD_WIDTH: process.env.MMD_WIDTH, MMD_HEIGHT: process.env.MMD_HEIGHT,
    MMD_SCALE: process.env.MMD_SCALE, MMD_BG: process.env.MMD_BG,
    MERMAID_LOG_FILE,
  });
  dbg('deps', {
    puppeteer: readPkg('puppeteer'),
    mermaidCli: readPkg('@mermaid-js/mermaid-cli'),
  });
  if (prev.length) {
    dbg('mermaid.prev', `── last ${prev.length} log lines from ${MERMAID_LOG_FILE} ──`);
    for (const l of prev) dbg(l);
  } else {
    dbg('mermaid.prev', '(no previous log entries)');
  }
}

/* ═════════════════  CONSTANTS & HELPERS  ═════════════════ */

const esImport = <T = any>(specifier: string) =>
  // using Function avoids TS compiling `import()` to require()
  (Function('s', 'return import(s)') as (s: string) => Promise<T>)(specifier);

const PNG_MAGIC  = Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]);

const isOn = (v?: string) => /^(1|true|on|yes)$/i.test(String(v ?? ''));

/** Resolve PlantUML jar if present; return null if missing or disabled. */
function resolvePlantumlJar(): string | null {
  const disabled = String(process.env.AUTHORD_PLANTUML ?? '').match(/^(0|off|false)$/i);
  if (disabled) return null;

  const expandHome = (p?: string) => p?.replace(/^~(?=$|[\\/])/, homedir());
  const envJar  = expandHome(process.env.PLANTUML_JAR);
  const vendor  = path.resolve(__dirname, '../vendor/plantuml.jar');
  const homeJar = path.resolve(homedir(), 'bin/plantuml.jar');

  for (const p of [envJar, vendor, homeJar]) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}
const PLANTUML_JAR = resolvePlantumlJar();

export const IMAGE_DIR = process.env.AUTHORD_IMAGE_DIR ||
                         path.resolve(process.cwd(),'images');

const VOID_RE = /<(hr|br|img|input|meta|link)(\s[^/>]*)?>/gi;          // XHTML tidy-up

/* ────────── hashing & PNG cache ────────── */
const hashString = (s: string): string => {
  let h = 5381; for (let i = 0; i < s.length; i++) h = (h << 5) + h + s.charCodeAt(i);
  return Math.abs(h).toString(16);
};

function isPngFileOK(p: string): boolean {
  try {
    const buf = fs.readFileSync(p);
    return buf.length >= 8 && buf.compare(PNG_MAGIC, 0, 8, 0, 8) === 0;
  } catch { return false; }
}

/* ═════════════  MERMAID (JS API) + CLEAN SHUTDOWN  ═════════════ */

let browserPromise: Promise<any> | null = null;
let closingBrowser = false;
let hooksRegistered = false;

function launchArgs() {
  const args = ['--no-sandbox','--disable-setuid-sandbox'];
  if (DEBUG || process.env.AUTHORD_CHROME_VERBOSE === '1') {
    args.push('--enable-logging=stderr','--v=1');
  }
  return args;
}

/** Try several headless modes for maximum compatibility. */
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      // FIX 1: use esImport so bundlers/ts don’t rewrite to require()
      const puppeteer = (await esImport<any>('puppeteer')).default;
      const preferred = (process.env.AUTHORD_HEADLESS ?? 'shell') as any;
      const trials: any[] = [preferred, 'new', true]; // try in this order

      let lastErr: unknown = null;
      for (const mode of trials) {
        try {
          dbg('puppeteer.launch try', { headless: mode, args: launchArgs() });
          const browser = await puppeteer.launch({ headless: mode, args: launchArgs() });
          registerShutdownHooks();
          dbg('puppeteer.launch success', { headless: mode });
          return browser;
        } catch (e) {
          lastErr = e;
          dbg('puppeteer.launch failed', { headless: mode, err: (e as any)?.message ?? e });
        }
      }
      throw new Error(`Puppeteer failed in modes [${trials.join(', ')}]: ${(lastErr as any)?.message ?? lastErr}`);
    })();
  }
  return browserPromise;
}

async function closeBrowser(): Promise<void> {
  if (!browserPromise || closingBrowser) return;
  closingBrowser = true;
  try {
    const br = await browserPromise;
    if (br && typeof br.close === 'function') {
      await br.close();
    }
  } catch {
    // swallow
  } finally {
    browserPromise = null;
    closingBrowser = false;
  }
}

function registerShutdownHooks() {
  if (hooksRegistered) return;
  hooksRegistered = true;

  const wrap = (exitCode?: number) => {
    return () => {
      (async () => {
        await closeBrowser();
        if (typeof exitCode === 'number') process.exit(exitCode);
      })().catch(() => process.exit(typeof exitCode === 'number' ? exitCode : 0));
    };
  };

  // Signals: close then exit
  process.on('SIGINT',  wrap(130));   // Ctrl+C
  process.on('SIGTERM', wrap(143));
  process.on('SIGHUP',  wrap(129));

  // beforeExit: Node is about to exit naturally — just close browser
  process.on('beforeExit', async () => { await closeBrowser(); });

  // Crash paths: report, close, then exit(1)
  process.on('uncaughtException', (err) => {
    console.error(err);
    (async () => { await closeBrowser(); process.exit(1); })();
  });
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
    (async () => { await closeBrowser(); process.exit(1); })();
  });
}

/* ───────── bin helper for CLI fallback ───────── */
function resolveBin(binName: string): string {
  const suffix = process.platform === 'win32' ? '.cmd' : '';
  const local = path.resolve(process.cwd(), 'node_modules', '.bin', binName + suffix);
  return fs.existsSync(local) ? local : (binName + suffix); // falls back to PATH
}

/* ───────── simple in-process telemetry (also appended to file) ───────── */
type MermaidStep = 'step1' | 'step2' | 'step3';
const telem = {
  counts: { step1: 0, step2: 0, step3: 0, success: 0, fail: 0 },
  lastSuccess: null as null | { step: MermaidStep; at: number },
};

function logAttempt(step: MermaidStep, ok: boolean, info: string) {
  if (ok) {
    telem.counts.success += 1;
    telem.counts[step] += 1;
    telem.lastSuccess = { step, at: Date.now() };
    dbg(`mermaid ${step} SUCCESS: ${info}`);
    appendMermaidLog(`SUCCESS via ${step}: ${info}`);
  } else {
    telem.counts.fail += 1;
    dbg(`mermaid ${step} FAIL: ${info}`);
    appendMermaidLog(`FAIL ${step}: ${info}`);
  }
}

/** Render a Mermaid PNG with a cascade.
 * Returns raw bytes or null on failure.
 */
async function renderMermaidPng(definition: string): Promise<Uint8Array | null> {
  logEnvOnce();

  // STEP 1 (puppeteer first)
  try {
    dbg('step1: import puppeteer first');
    const puppeteer = await esImport<any>('puppeteer'); // ensure installed
    dbg('step1: import @mermaid-js/mermaid-cli');
    const mcli = await esImport<any>('@mermaid-js/mermaid-cli'); // <- ESM path
    const { renderMermaid } = mcli;

    dbg('step1: launching browser');
    const browser = await getBrowser();
    dbg('step1: calling renderMermaid');
    const { data } = await renderMermaid(browser, definition, 'png', {
      viewport: {
        width: parseInt(process.env.MMD_WIDTH  || '800', 10),
        height: parseInt(process.env.MMD_HEIGHT || '600', 10),
        deviceScaleFactor: parseInt(process.env.MMD_SCALE || '1', 10),
      },
      backgroundColor: process.env.MMD_BG || 'white',
      mermaidConfig: {},
    });
    dbg('step1: render success');
    // FIX 2: record telemetry
    logAttempt('step1', true, 'JS API (puppeteer first)');
    return data as Uint8Array;
  } catch (e1) {
    const msg = (e1 as any)?.message ?? String(e1);
    warn('Mermaid step1 failed:', (e1 as any)?.stack ?? msg);
    dbg('mermaid step1 FAIL:', msg);
    logAttempt('step1', false, msg);
  }

  // STEP 2 (mermaid first; puppeteer may be transitive)
  try {
    dbg('step2: import @mermaid-js/mermaid-cli first');
    const mcli = await esImport<any>('@mermaid-js/mermaid-cli'); // <- ESM path
    const { renderMermaid } = mcli;
    dbg('step2: import puppeteer');
    await esImport<any>('puppeteer');

    dbg('step2: launching browser');
    const browser = await getBrowser();
    dbg('step2: calling renderMermaid');
    const { data } = await renderMermaid(browser, definition, 'png', {
      viewport: {
        width: parseInt(process.env.MMD_WIDTH  || '800', 10),
        height: parseInt(process.env.MMD_HEIGHT || '600', 10),
        deviceScaleFactor: parseInt(process.env.MMD_SCALE || '1', 10),
      },
      backgroundColor: process.env.MMD_BG || 'white',
      mermaidConfig: {},
    });
    dbg('step2: render success');
    // FIX 2: record telemetry
    logAttempt('step2', true, 'JS API (cli first)');
    return data as Uint8Array;
  } catch (e2) {
    const msg = (e2 as any)?.message ?? String(e2);
    warn('Mermaid step2 failed:', (e2 as any)?.stack ?? msg);
    dbg('mermaid step2 FAIL:', msg);
    logAttempt('step2', false, msg);
  }

  // ── Step 3: CLI fallback (opt-in with AUTHORD_MERMAID_FALLBACK_CLI=1) ──────
  if (isOn(process.env.AUTHORD_MERMAID_FALLBACK_CLI)) {
    try {
      const tmpOut = path.join(
        tmpdir(),
        `mmd-${Date.now()}-${Math.random().toString(36).slice(2)}.png`
      );
      const mmdc = resolveBin('mmdc');
      dbg('step3: CLI fallback', { mmdc, tmpOut });
      execFileSync(mmdc, ['-i', '-', '-o', tmpOut, '-q'], {
        input: definition,
        stdio: ['pipe', 'ignore', 'inherit'],
        maxBuffer: 1024 * 1024 * 64,
      });
      const buf = fs.readFileSync(tmpOut);
      try { fs.unlinkSync(tmpOut); } catch {}
      logAttempt('step3', true, `CLI mmdc (${mmdc})`);
      return new Uint8Array(buf);
    } catch (e3) {
      const msg = (e3 as any)?.stack ?? (e3 as any)?.message ?? String(e3);
      warn('CLI fallback failed:', msg);
      logAttempt('step3', false, msg);
    }
  } else {
    dbg('step3: CLI fallback disabled (AUTHORD_MERMAID_FALLBACK_CLI not set)');
    appendMermaidLog('CLI fallback disabled (AUTHORD_MERMAID_FALLBACK_CLI not set)');
  }

  appendMermaidLog('All strategies failed; leaving code block intact');
  warn('Mermaid rendering failed; keeping code block.');
  return null;
}

/* ────────── copy / hard-link PNGs into IMAGE_DIR ────────── */
const ensureDiagramInImageDir = (() => {
  const handled = new Set<string>();
  return (pngPath: string): string => {
    if (handled.has(pngPath)) return path.basename(pngPath);

    const targetDir  = IMAGE_DIR;
    const targetPath = path.join(targetDir, path.basename(pngPath));

    if (!fs.existsSync(targetPath)) {
      fs.mkdirSync(targetDir, { recursive: true });
      try { fs.linkSync(pngPath, targetPath); }
      catch { fs.copyFileSync(pngPath, targetPath); }
    }
    handled.add(pngPath);
    return path.basename(pngPath);
  };
})();

/* ═══════════════  PRE-PROCESSOR (ASYNC)  ═══════════════ */

const makeStub = (file: string, params = '') =>
  `@@ATTACH|file=${path.basename(file)}${params ? `|${params}` : ''}@@`;

/** Async diagram generator: returns path to cached PNG or null to keep code block. */
async function diagramToPngAsync(lang: 'plantuml' | 'mermaid', code: string): Promise<string | null> {
  const out = path.join(WORK_DIR, `${hashString(lang + '::' + code)}.png`);

  // Use cache if present and valid
  if (fs.existsSync(out) && isPngFileOK(out)) return out;

  try {
    if (lang === 'plantuml') {
      if (!PLANTUML_JAR) {
        warn('PlantUML not available; leaving code block unchanged.');
        return null;
      }
      const png = execFileSync('java', ['-jar', PLANTUML_JAR, '-tpng', '-pipe'],
                               { input: code, stdio: ['pipe','pipe','inherit'] });
      await fsp.writeFile(out, png);
      return out;
    }

    // Mermaid via cascade
    const bytes = await renderMermaidPng(code);
    if (!bytes) return null;

    await fsp.writeFile(out, Buffer.from(bytes));
    return out;
  } catch (e) {
    try { if (fs.existsSync(out)) await fsp.unlink(out); } catch {}
    warn('diagramToPngAsync error:', (e as any)?.stack ?? (e as any)?.message ?? e);
    return null;
  }
}

function extractSizeParamsAfterImage(parent: Parent | undefined, idx: number): string {
  if (!parent || idx + 1 >= (parent.children?.length ?? 0)) return '';
  const next = (parent.children as any)[idx + 1];
  if (next?.type === 'text' && /^\{\s*[^}]+\s*\}/.test(next.value)) {
    (parent.children as any).splice(idx + 1, 1);
    return String(next.value).replace(/^\{\s*|\s*\}$/g, '');
  }
  return '';
}

/** Walk the mdast tree asynchronously and convert images/diagrams to stubs. */
async function preprocess(md: string): Promise<string> {
  const tree: any = unified().use(remarkParse).use(remarkDirective).parse(md);

  async function visitNode(node: UnistNode, parent?: Parent, index?: number): Promise<void> {
    // Code blocks → potential diagrams
    if (node.type === 'code' && (node as any).lang &&
        ((node as any).lang === 'plantuml' || (node as any).lang === 'mermaid')) {
      const png = await diagramToPngAsync((node as any).lang, (node as Code).value.trim());
      if (png && parent && typeof index === 'number') {
        const file = ensureDiagramInImageDir(png);
        (parent.children as any)[index] = { type: 'html', value: makeStub(file) };
      }
      return; // done
    }

    // Markdown images → attachment stubs with optional size params
    if (node.type === 'image' && parent && typeof index === 'number') {
      const img  = node as Image;
      const base = path.basename(String(img.url).split(/[?#]/)[0]);
      const params = extractSizeParamsAfterImage(parent, index);
      (parent.children as any)[index] = { type: 'html', value: makeStub(base, params) };
      return;
    }

    // Raw HTML with <img> → convert to attachment stubs
    if (node.type === 'html') {
      (node as any).value = String((node as any).value).replace(
        /<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi,
        (_m: string, src: string): string => {
          const base   = path.basename(src.split(/[?#]/)[0]);
          const widthM = _m.match(/\bwidth=["'](\d+)(?:px)?["']/i);
          const params = widthM ? `width=${widthM[1]}` : '';
          return makeStub(base, params);
        });
      // continue to children if any
    }

    // Recurse into children
    const anyNode = node as any;
    if (Array.isArray(anyNode.children)) {
      for (let i = 0; i < anyNode.children.length; i++) {
        await visitNode(anyNode.children[i], anyNode, i);
      }
    }
  }

  await visitNode(tree as any);
  return unified().use(remarkStringify).stringify(tree);
}

/* ═══════════  MARKDOWN → HTML → XHTML  ═══════════ */

const markdownToHtml = (md: string) =>
  String(
    unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkDirective)
      .use(remarkRehype,   { allowDangerousHtml: true })
      .use(rehypeRaw)
      .use(rehypeStringify,{ allowDangerousHtml: true })
      .processSync(md),
  );

function replacePlaceholders(html: string): string {
  /* unwrap links around our stubs */
  html = html.replace(/<a[^>]*>(@@ATTACH\|file=[^@]+@@)<\/a>/gi, '$1');

  /* @@ATTACH|file=… → <ac:image …> */
  html = html.replace(
    /@@ATTACH\|file=([^|@]+)(?:\|([^@]+))?@@/gi,
    (_all, file, raw = '') => {
      const paramMap = Object.fromEntries(
        raw.split(';')
           .filter(Boolean)
           .map((p: string) => p.split('=').map((s: string) => s.trim()))
      ) as Record<string, string>;

      /* normalise widths/heights like “450px” → “450” */
      if (paramMap.width  ) paramMap.width  = paramMap.width.replace(/px$/i, '');
      if (paramMap.height ) paramMap.height = paramMap.height.replace(/px$/i, '');

      const attrs: string[] = [];
      if (paramMap.width )  attrs.push(`ac:width="${paramMap.width}"`);
      if (paramMap.height)  attrs.push(`ac:height="${paramMap.height}"`);
      if (attrs.length)     attrs.push('ac:thumbnail="true"');   // Server/DC needs this

      /* add native dimensions when available */
      try {
        const { width: w = 0, height: h = 0 } =
          imageSize(fs.readFileSync(path.join(IMAGE_DIR, file)) as any) as any;
        if (w) attrs.push(`ac:original-width="${w}"`);
        if (h) attrs.push(`ac:original-height="${h}"`);
      } catch {/* ignore if file is not local yet */ }

      const attrStr = attrs.length ? ' ' + attrs.join(' ') : '';
      return `<ac:image${attrStr}>\n  <ri:attachment ri:filename="${file}"/>\n</ac:image>`;
    });

  /* markdown ~~strike~~ → Confluence-friendly inline style */
  html = html.replace(/<del>(.*?)<\/del>/gi,
                      '<span style="text-decoration:line-through;">$1</span>');

  return html;
}

/* self-close void tags + wrap in Confluence namespace */
const wrapXhtml = (inner: string): string =>
  `<div xmlns:ac="http://atlassian.com/content" xmlns:ri="http://atlassian.com/resource/identifier">` +
    inner
      .replace(VOID_RE, (_: string, tag: string, rest = '') =>
        `<${tag}${(rest || '').trimEnd()}/>`)             // convert <hr> → <hr/>
      .replace(/&(?!(?:[a-z]+|#\d+);)/g, '&amp;') +      // escape naked &
  `</div>`;

/* ═══════════  TRANSFORMER CLASS (ASYNC)  ═══════════ */

export class WritersideMarkdownTransformerDC extends MarkdownTransformer {
  constructor(schema: Schema = defaultSchema) { super(schema); }

  /** Confluence storage (XHTML) — now async */
  async toStorage(md: string) {
    const pre  = await preprocess(md);

    // At the start of each transform, emit a short telemetry summary (DEBUG only)
    if (DEBUG) {
      dbg('mermaid.summary', {
        counts: telem.counts,
        lastSuccess: telem.lastSuccess
          ? { step: telem.lastSuccess.step, when: new Date(telem.lastSuccess.at).toISOString() }
          : null,
        logFile: MERMAID_LOG_FILE,
      });
    }

    const html = markdownToHtml(pre);
    return {
      value: wrapXhtml(replacePlaceholders(html)),
      representation: 'storage' as const,
    };
  }

  /** Round-trip ADF — pre-process async, then parse */
  async toADF(md: string) {
    const pre   = await preprocess(md);
    const round = String(await unified().use(remarkParse).process(pre));
    return super.parse(round).toJSON();
  }
}

/** Default instance (methods are async now) */
export default new WritersideMarkdownTransformerDC();
