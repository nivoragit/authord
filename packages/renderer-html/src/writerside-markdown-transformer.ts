/* writerside-markdown-transformer.ts
 * Fully offline PlantUML & Mermaid support (optimized drop-in replacement):
 *  - Detects ```plantuml``` / ```mermaid``` blocks
 *  - Uses Java + PlantUML or Mermaid CLI to generate PNG via STDIN
 *  - Caches paths and temp directory for performance
 *  - Replaces blocks with Markdown image links
 *  - Integrates into existing ADF pipeline
 */

import { MarkdownTransformer } from '@atlaskit/editor-markdown-transformer';
import { defaultSchema } from '@atlaskit/adf-schema/schema-default';
import type { Schema } from 'prosemirror-model';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkDirective from 'remark-directive';
import remarkStringify from 'remark-stringify';
import { visit } from 'unist-util-visit';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir, homedir } from 'os';

/* ──────────────────────────────────────────────────────────────── */
/* 1. Constants & helpers                                           */
/* ──────────────────────────────────────────────────────────────── */

const SAFE_LANGS = new Set<string>([
  'abap', 'actionscript3', 'applescript', 'bash', 'c', 'clojure', 'cpp', 'csharp',
  'css', 'diff', 'docker', 'elixir', 'erlang', 'go', 'groovy', 'haskell', 'java',
  'javascript', 'js', 'json', 'kotlin', 'less', 'lua', 'makefile', 'markdown',
  'matlab', 'objective-c', 'perl', 'php', 'powershell', 'python', 'r', 'ruby',
  'rust', 'sass', 'scala', 'shell', 'sql', 'swift', 'typescript', 'yaml'
]);

const ATTR_WHITELIST: Record<string, string[]> = {
  heading: ['level'],
  orderedList: ['order'],
  codeBlock: ['language'],
  link: ['href'],
  panel: ['panelType'],
  mediaSingle: ['layout'],
  media: ['type', 'url', 'alt', 'width'],
  table: ['isNumberColumnEnabled', 'layout'],
  tableHeader: ['colspan', 'rowspan'],
  tableCell: ['colspan', 'rowspan'],
  expand: ['title'],
  bodiedExtension: ['extensionType', 'extensionKey', 'parameters'],
  multiBodiedExtension: ['extensionType', 'extensionKey', 'parameters'],
  extension: ['extensionType', 'extensionKey', 'parameters'],
  taskItem: ['localId', 'state'],
  decisionItem: ['localId'],
  date: ['timestamp'],
  mention: ['id', 'text', 'userType']
};

const MARK_ATTR_WHITELIST = new Set(['href']);
const MARK_TYPE_WHITELIST = new Set([
  'strong', 'em', 'underline', 'strike', 'link', 'subsup', 'code', 'textColor'
]);

const stripHtml = (txt: string) => txt.replace(/<[^>]+>/g, '');

/* ──────────────────────────────────────────────────────────────── */
/* 2. Fast, cached diagram generator                               */
/* ──────────────────────────────────────────────────────────────── */

const WORK_DIR = path.join(tmpdir(), 'writerside-diagrams');
fs.mkdirSync(WORK_DIR, { recursive: true });

const PLANTUML_JAR = (() => {
  const envJar = process.env.PLANTUML_JAR?.replace(/^~(?=$|[\\/])/, homedir());
  const vendorJar = path.resolve(__dirname, '../vendor/plantuml.jar');
  const homeJar = path.resolve(homedir(), 'bin', 'plantuml.jar');
  const found = [envJar, vendorJar, homeJar].find(p => p && fs.existsSync(p));
  if (!found) {
    throw new Error(
      'plantuml.jar not found in $PLANTUML_JAR, vendor/, or ~/bin'
    );
  }
  return found;
})();

function defaultDiagramGenerator(
  lang: 'plantuml' | 'mermaid',
  code: string
): string {
  // 1 ️⃣  Derive a deterministic file name
  const contentHash = hashString(code);
  const outPath = path.join(WORK_DIR, `${contentHash}.png`);

  // 2 ️⃣  Short-circuit if we already have a valid PNG
  if (fs.existsSync(outPath)) {
    const fd = fs.openSync(outPath, 'r');
    try {
      const sigBuf = Buffer.alloc(8);
      fs.readSync(fd, sigBuf, 0, 8, 0);
      // compare to PNG signature:
      if (sigBuf.equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) {
        return outPath;
      }
    } finally {
      fs.closeSync(fd);
    }
    fs.unlinkSync(outPath);
  }
  // 3 ️⃣  Generate the diagram in PNG **directly**
  if (lang === 'plantuml') {
    // -tpng tells PlantUML to output PNG to stdout
    const png = execFileSync(
      'java',
      ['-jar', PLANTUML_JAR, '-tpng', '-pipe'],
      { input: code, encoding: null, stdio: ['pipe', 'pipe', 'inherit'] }
    );
    fs.writeFileSync(outPath, png);       // binary write
  } else if (lang === 'mermaid') {
    /*  mmdc can read from stdin (`--input -`) and will emit the format
        implied by --output’s file-extension.                            */
    execFileSync(
      'mmdc',
      ['--input', '-', '--output', outPath, '--quiet'],
      { input: code, stdio: ['pipe', 'ignore', 'inherit'] }
    );
  } else {
    throw new Error(`Unsupported language: ${lang}`);
  }

  return outPath;
}



// Simple string hashing function
function hashString(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) + hash + str.charCodeAt(i);
  }
  return Math.abs(hash).toString(16);
}

/* ──────────────────────────────────────────────────────────────── */
/* 3. Transformer                                                 */
/* ──────────────────────────────────────────────────────────────── */

export class WritersideMarkdownTransformer extends MarkdownTransformer {
  private readonly diagramGenerator: (lang: 'plantuml' | 'mermaid', code: string) => string;

  constructor(
    schema: Schema = defaultSchema,
    diagramGenerator: (lang: 'plantuml' | 'mermaid', code: string) => string = defaultDiagramGenerator
  ) {
    super(schema);
    this.diagramGenerator = diagramGenerator;
  }

  toADF(md: string): any {
    const adf = finalSanitize(this._parseToJson(md));
    adf.version = 1;
    return adf;
  }

  private _parseToJson(md: string): any {
    const roundTripped = unified()
      .use(remarkParse)
      .use(remarkPreserveComments)
      .use(remarkDirective)
      .use(remarkStringify as any)
      .processSync(preprocess(md, this.diagramGenerator))
      .toString();

    const base = super.parse(roundTripped).toJSON() as any;
    base.content = base.content.filter(
      (n: any) => !(n.type === 'paragraph' && (!n.content || n.content.length === 0))
    );
    return walk(groupExpandContent(base), transformNode);
  }
}

/* ──────────────────────────────────────────────────────────────── */
/* 4. Final sanitiser                                             */
/* ──────────────────────────────────────────────────────────────── */

function sanitizeMarks(marks?: any[]): any[] | undefined {
  if (!marks) return;
  const clean: any[] = [];
  for (const m of marks) {
    if (!MARK_TYPE_WHITELIST.has(m.type)) continue;
    if (m.type === 'link' && m.attrs) {
      Object.keys(m.attrs).forEach(k => {
        if (!MARK_ATTR_WHITELIST.has(k) || !m.attrs[k]) delete m.attrs[k];
      });
      if (!Object.keys(m.attrs).length) delete m.attrs;
    }
    clean.push(m);
  }
  return clean.length ? clean : undefined;
}

function finalSanitize(node: any): any {
  if (Array.isArray(node)) {
    const arr = node.map(finalSanitize).filter(Boolean);
    return arr.length ? arr : null;
  }
  if (node && typeof node === 'object') {
    if (node.type === 'text') {
      const txt = stripHtml(node.text || '').trim();
      return txt ? { ...node, text: txt } : null;
    }
    if (node.content) {
      node.content = finalSanitize(node.content);
      if (!node.content?.length) return null;
    }
    if (node.marks) node.marks = sanitizeMarks(node.marks);
    if (node.attrs) {
      const allowed = new Set(ATTR_WHITELIST[node.type] || []);
      Object.keys(node.attrs).forEach(k => {
        if (!allowed.has(k) || node.attrs[k] == null || node.attrs[k] === '') {
          delete node.attrs[k];
        }
      });
      if (!Object.keys(node.attrs).length) delete node.attrs;
    }
    if (node.type === 'codeBlock') {
      const txtNode = node.content?.[0];
      if (txtNode?.type === 'text') {
        txtNode.text = txtNode.text.replace(/\r\n?/g, '\n');
      }
      if (node.attrs?.language && !SAFE_LANGS.has(node.attrs.language)) {
        delete node.attrs.language;
      }
    }
  }
  return node;
}

/* ──────────────────────────────────────────────────────────────── */
/* 5. Pre-parse cleanup & diagram handling                         */
/* ──────────────────────────────────────────────────────────────── */

function preprocess(
  md: string,
  diagramGenerator?: (lang: 'plantuml' | 'mermaid', code: string) => string
): string {
  if (diagramGenerator) {
    md = md.replace(
      /```(plantuml|mermaid)[^\n]*\n([\s\S]*?)```/gi,
      (_, lang: 'plantuml' | 'mermaid', code: string) => {
        try {
          const pngPath = diagramGenerator(lang, code.trim());
          const file = path.basename(pngPath);
          return `\n\n@@ATTACH:${file}@@\n\n`;
        } catch (e) {
          console.error(`Diagram generation failed (${lang}):`, e);
          return _;
        }
      }
    );
  }
  return md
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, (_, i) => `\n\n\`\`\`\n${i.trim()}\n\`\`\`\n\n`)
    .replace(
      /<procedure[^>]*id="([^"]*)"[^>]*title="([^"]*)"[^>]*>([\s\S]*?)<\/procedure>/gi,
      (_, id, t, i) => `\n\n@@PROCEDURE_BODY:${id}:${t}@@\n\n${i.trim()}\n\n@@PROCEDURE_END@@\n\n`
    )
    .replace(
      /<include[^>]*from="([^"]*)"[^>]*element-id="([^"]*)".*?>/gi,
      (_, f, e) => `\n\n@@INCLUDE:${f}:${e}@@\n\n`
    )
    .replace(/<tabs[^>]*>([\s\S]*?)<\/tabs>/gi, (_, inner) => {
      const tabs = inner.match(/<tab[^>]*title="([^"]+)"[^>]*>([\s\S]*?)<\/tab>/gi);
      if (!tabs) return '\n\n@@TABS_EMPTY@@\n\n';
      const out: string[] = ['@@TABS_START@@'];
      tabs.forEach((tab: string) => {
        const [, ttl, body] = /<tab[^>]*title="([^"]+)"[^>]*>([\s\S]*?)<\/tab>/i.exec(tab)!;
        out.push(`@@TAB_TITLE:${ttl}@@`, body.trim(), '@@TAB_END@@');
      });
      out.push('@@TABS_END@@');
      return `\n\n${out.join('\n\n')}\n\n`;
    })
    .replace(/<seealso>([\s\S]*?)<\/seealso>/gi, (_, inner) => {
      const links = inner.match(/<a href="([^"]+)">([^<]+)<\/a>/gi) || [];
      const encoded = links.map((l: string) => {
        const [, href, text] = /<a href="([^"]+)">([^<]+)<\/a>/.exec(l)!;
        return `${href}|${text}`;
      }).join(';');
      return `\n\n@@SEEALSO:${encoded}@@\n\n`;
    })
    .replace(
      /<img([^>]*?)src=["']([^"']+)["']([^>]*?)alt=["']([^']*)["']([^>]*?)\/?>/gi,
      (_, pre1, src, pre2, alt, post) => {
        const width = /width=["']?(\d+)/i.exec(pre1 + pre2 + post)?.[1];
        const title = width ? ` "${JSON.stringify({ width })}"` : '';
        return `\n\n![${alt}](${src}${title})\n\n`;
      }
    )
    .replace(/<code>([\s\S]*?)<\/code>/gi, (_, i) => '`' + i + '`')
    .replace(/<shortcut[^>]*>([\s\S]*?)<\/shortcut>/gi, (_, i) => '`' + i + '`')
    .replace(/<!--[\s\S]*?-->/g, '\n\n')
    .replace(/^\s*\{[^}]+\}\s*$/gm, '')
    .replace(/^(#{1,6} .+?)\n(?!\n)/gm, '$1\n\n')
    .replace(
      /<panel type="(\w+)">([\s\S]*?)<\/panel>/gi,
      (_, t, c) => `\n\n@@PANEL:${t}:${c.trim()}@@\n\n`
    )
    .replace(/<taskList>([\s\S]*?)<\/taskList>/gi, (_, inner) => {
      const items = inner.match(/<taskItem state="(\w+)">([\s\S]*?)<\/taskItem>/gi) || [];
      const out = ['@@TASK_START@@', ...items.map((it: string) => {
        const [, s, c] = /<taskItem state="(\w+)">([\s\S]*?)<\/taskItem>/i.exec(it)!;
        return `@@TASK_ITEM:${s}:${c.trim()}@@`;
      }), '@@TASK_END@@'];
      return `\n\n${out.join('\n')}\n\n`;
    })
    .replace(/<decisionList>([\s\S]*?)<\/decisionList>/gi, (_, inner) => {
      const items = inner.match(/<decisionItem>([\s\S]*?)<\/decisionItem>/gi) || [];
      const out = ['@@DECISION_START@@', ...items.map((it: string) => {
        return `@@DECISION_ITEM:${/<decisionItem>([\s\S]*?)<\/decisionItem>/i.exec(it)![1].trim()}@@`;
      }), '@@DECISION_END@@'];
      return `\n\n${out.join('\n')}\n\n`;
    })
    .replace(/<date timestamp="(\d+)"\s*\/>/gi, (_, ts) => `\n\n@@DATE:${ts}@@\n\n`)
    .replace(
      /!\[([^\]]+)\]\(([^)]+)\)((?:\s*\{[^}]+\})+)/g,
      (_, _alt, url, braces) => {
        // collect the inner bits "width=290" and "border-effect=line"
        const params = [...braces.matchAll(/\{([^}]+)\}/g)]
          .map(m => m[1].trim())
          .join(';');
        const file = path.basename(url);
        return `\n\n@@ATTACH:${file}|${params}@@\n\n`;
      });
}

/* ──────────────────────────────────────────────────────────────── */
/* 6. Preserve HTML comments as code blocks                       */
/* ──────────────────────────────────────────────────────────────── */

function remarkPreserveComments() {
  return (tree: any) => {
    visit(tree, 'html', (node: any, i?: number, p?: any) => {
      if (!p || !node.value.startsWith('<!--')) return;
      p.children.splice(i!, 1, {
        type: 'code',
        lang: 'comment',
        value: node.value.replace(/^<!--|-->$/g, '').trim()
      });
    });
  };
}

/* ──────────────────────────────────────────────────────────────── */
/* 7. Structural transforms                                       */
/* ──────────────────────────────────────────────────────────────── */

function walk(n: any, fn: (x: any, p?: any) => any, p?: any): any {
  const mapped = fn({ ...n }, p);
  if (mapped?.content) {
    mapped.content = mapped.content
      .map((c: any) => walk(c, fn, mapped))
      .filter(Boolean);
  }
  return mapped;
}

function groupExpandContent(doc: any): any {
  for (let i = 0; i < doc.content.length - 1; i++) {
    const node = doc.content[i], next = doc.content[i + 1];
    if (node.type === 'expand' && next.type === 'paragraph') {
      node.content = next.content;
      doc.content.splice(i + 1, 1);
    }
  }
  return doc;
}

function transformNode(node: any, parent?: any): any {
  const isParagraph = (n: any, txt?: string) =>
    n.type === 'paragraph' &&
    Array.isArray(n.content) &&
    n.content[0]?.type === 'text' &&
    typeof n.content[0].text === 'string' &&
    (txt ? n.content[0].text === txt : true);

  const extension = (
    type: 'extension' | 'bodiedExtension' | 'multiBodiedExtension',
    key: string,
    parameters: Record<string, any> = {},
    content: any[] = []
  ) => ({
    type,
    attrs: { extensionType: 'com.writerside', extensionKey: key, parameters },
    ...(content.length ? { content } : {})
  });

  // PROCEDURE BODY
  if (isParagraph(node) && node.content[0].text.startsWith('@@PROCEDURE_BODY:')) {
    const [, id, title] = node.content[0].text.split(':');
    const body: any[] = [];
    let idx = parent!.content.indexOf(node) + 1;
    while (!isParagraph(parent!.content[idx], '@@PROCEDURE_END@@')) {
      body.push(parent!.content.splice(idx, 1)[0]);
    }
    parent!.content.splice(idx, 1);
    return extension('bodiedExtension', 'procedure', { id, title }, body);
  }

  // TABS
  if (isParagraph(node, '@@TABS_START@@')) {
    const idxStart = parent!.content.indexOf(node);
    const titles: string[] = [];
    const tabBodies: any[] = [];
    let idx = idxStart + 1;
    while (!isParagraph(parent!.content[idx], '@@TABS_END@@')) {
      const titlePar = parent!.content[idx];
      const raw = titlePar?.content?.[0]?.text;
      if (typeof raw === 'string') {
        const match = raw.match(/^@@TAB_TITLE:(.+)@@$/);
        if (match) {
          titles.push(match[1]);
          parent!.content.splice(idx, 1);
          const body: any[] = [];
          while (!isParagraph(parent!.content[idx], '@@TAB_END@@')) {
            body.push(parent!.content.splice(idx, 1)[0]);
          }
          parent!.content.splice(idx, 1);
          tabBodies.push({ type: 'extensionBody', content: body });
          continue;
        }
      }
      idx++;
    }
    parent!.content.splice(idx, 1);
    parent!.content.splice(idxStart, 1);
    return extension('multiBodiedExtension', 'tabs', { titles }, tabBodies);
  }

  // INLINE PLACEHOLDERS
  if (isParagraph(node)) {
    const text = node.content[0].text;
    if (text.startsWith('@@INCLUDE:')) {
      const [, from, elementId] = text.split(':');
      return extension('extension', 'include', { from, 'element-id': elementId });
    }
    if (text === '@@TABS_EMPTY@@') {
      return extension('multiBodiedExtension', 'tabs');
    }
    if (text.startsWith('@@SEEALSO:')) {
      const links = text
        .slice('@@SEEALSO:'.length)
        .split(';')
        .map((p: { split: (arg0: string) => [any, any]; }) => {
          const [href, label] = p.split('|');
          return { href, label };
        });
      return extension('extension', 'seealso', { links });
    }
    if (text.startsWith('@@PANEL:')) {
      const [, panelType, content] = text.split(':');
      return {
        type: 'panel',
        attrs: { panelType: panelType.toLowerCase() },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: content }] }],
      };
    }
    if (text.startsWith('@@DATE:')) {
      return { type: 'date', attrs: { timestamp: parseInt(text.slice('@@DATE:'.length), 10) } };
    }
  }

  // TASKS
  if (isParagraph(node, '@@TASK_START@@')) {
    const idxStart = parent!.content.indexOf(node);
    const items: any[] = [];
    let idx = idxStart + 1;
    while (!isParagraph(parent!.content[idx], '@@TASK_END@@')) {
      const item = parent!.content[idx];
      const raw = item?.content?.[0]?.text;
      if (typeof raw === 'string' && raw.startsWith('@@TASK_ITEM:')) {
        const [, state, content] = raw.split(':');
        items.push({
          type: 'taskItem',
          attrs: { localId: `task-${items.length + 1}`, state: state === 'DONE' ? 'DONE' : 'TODO' },
          content: [{ type: 'text', text: content }],
        });
        parent!.content.splice(idx, 1);
        continue;
      }
      idx++;
    }
    parent!.content.splice(idx, 1);
    parent!.content.splice(idxStart, 1);
    return { type: 'taskList', content: items };
  }

  // DECISIONS
  if (isParagraph(node, '@@DECISION_START@@')) {
    const idxStart = parent!.content.indexOf(node);
    const items: any[] = [];
    let idx = idxStart + 1;
    while (!isParagraph(parent!.content[idx], '@@DECISION_END@@')) {
      const item = parent!.content[idx];
      const raw = item?.content?.[0]?.text;
      if (typeof raw === 'string' && raw.startsWith('@@DECISION_ITEM:')) {
        const text = raw.replace('@@DECISION_ITEM:', '');
        items.push({
          type: 'decisionItem',
          attrs: { localId: `dec-${items.length + 1}` },
          content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
        });
        parent!.content.splice(idx, 1);
        continue;
      }
      idx++;
    }
    parent!.content.splice(idx, 1);
    parent!.content.splice(idxStart, 1);
    return { type: 'decisionList', content: items };
  }

  // COLLAPSIBLE HEADINGS
  if (node.type === 'heading') {
    const first = node.content?.[0];
    if (first?.type === 'text' && typeof first.text === 'string') {
      const m = first.text.match(/^(.*)\s+\{collapsible="true"\}$/);
      if (m) {
        return { type: 'expand', attrs: { title: m[1] }, content: [] };
      }
    }
  }

  // CLEANUP empty/macro-only paragraphs
  if (
    node.type === 'paragraph' &&
    (
      !node.content?.length ||
      (node.content.every((c: any) => c.type === 'text') &&
        /^\{[^}]+\}$/.test(node.content.map((c: any) => c.text).join('').trim()))
    )
  ) {
    return null;
  }

  // convert @@ATTACH into a stub paragraph
  if (
    node.type === 'paragraph' &&
    typeof node.content?.[0]?.text === 'string' &&
    node.content[0].text.startsWith('@@ATTACH:')
  ) {
    const file = node.content[0].text.replace('@@ATTACH:', '');
    return {
      type: 'paragraph',
      content: [{ type: 'text', text: `ATTACH-STUB:${file}` }]
    };
  }

  return node;
}



export { preprocess, defaultDiagramGenerator };