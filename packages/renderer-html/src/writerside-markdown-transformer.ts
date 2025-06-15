import { MarkdownTransformer } from '@atlaskit/editor-markdown-transformer';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkDirective from 'remark-directive';
import remarkStringify from 'remark-stringify';
import { visit } from 'unist-util-visit';
import { Node as PMNode } from 'prosemirror-model';
import { defaultSchema } from '@atlaskit/adf-schema/schema-default';

/* ──────────────────────────────────────────────── */
/* 1. Constants & helpers                           */
/* ──────────────────────────────────────────────── */

const SAFE_LANGS = new Set<string>([
  'abap','actionscript3','applescript','bash','c','clojure','cpp','csharp','css','diff','docker','elixir',
  'erlang','go','groovy','haskell','java','javascript','js','json','kotlin','less','lua','makefile','markdown',
  'matlab','objective-c','perl','php','powershell','python','r','ruby','rust','sass','scala','shell','sql',
  'swift','typescript','yaml',
  'mermaid','plantuml'        // allow diagram languages
]);

const ATTR_WHITELIST: Record<string, string[]> = {
  heading:      ['level'],
  orderedList:  ['order'],
  codeBlock:    ['language'],
  link:         ['href'],
  panel:        ['panelType'],
  mediaSingle:  ['layout'],
  media:        ['type','url','alt'],
  table:        ['isNumberColumnEnabled','layout'],
  tableHeader:  ['colspan','rowspan'],
  tableCell:    ['colspan','rowspan'],
  expand:               ['title'],
  bodiedExtension:      ['extensionType','extensionKey','parameters'],
  multiBodiedExtension: ['extensionType','extensionKey','parameters'],
  extension:            ['extensionType','extensionKey','parameters'],
  taskItem:             ['localId','state'],
  taskList:             [],
  decisionItem:         ['localId'],
  decisionList:         [],
  date:                 ['timestamp'],
  mention:              ['id','text','userType']
};

const MARK_ATTR_WHITELIST: Record<string, string[]> = { link: ['href'] };
const MARK_TYPE_WHITELIST = new Set([
  'strong', 'em', 'underline', 'strike',
  'link', 'subsup', 'code', 'textColor'
]);

const stripHtml = (txt: string) => txt.replace(/<[^>]+>/g, '');

/* ──────────────────────────────────────────────── */
/* 2. Transformer                                  */
/* ──────────────────────────────────────────────── */

export class WritersideMarkdownTransformer extends MarkdownTransformer {
  /** Return ADF JSON object (not string) */
  toADF(md: string): any {
    const adf = finalSanitize(this._parseToJson(md));
    adf.version = 1;
    return adf;
  }

  /** ───────── INTERNAL ───────── */
  private _parseToJson(md: string): any {
    const cleaned = preprocess(md);
    const roundTripped = unified()
      .use(remarkParse)
      .use(remarkPreserveComments)
      .use(remarkDirective)
      .use(remarkStringify as any)
      .processSync(cleaned)
      .toString();

    const base = super.parse(roundTripped).toJSON() as any;
    base.version = 1;
    base.content = base.content.filter(
      (n: any) => !(n.type === 'paragraph' && (!n.content || n.content.length === 0))
    );

    const grouped      = groupExpandContent(base);
    const transformed  = walk(grouped, transformNode);
    return transformed;
  }
}

/* ──────────────────────────────────────────────── */
/* 3. Final sanitiser (schema-strict for Cloud)     */
/* ──────────────────────────────────────────────── */

function sanitizeMarks(marks?: any[]): any[] | undefined {
  if (!marks) return undefined;
  const clean: any[] = [];
  for (const m of marks) {
    if (!MARK_TYPE_WHITELIST.has(m.type)) continue;
    if (m.type === 'link') {
      const allowed = new Set(MARK_ATTR_WHITELIST.link);
      for (const k of Object.keys(m.attrs ?? {})) {
        if (m.attrs[k] === '' || m.attrs[k] == null || !allowed.has(k)) delete m.attrs[k];
      }
      if (!m.attrs || Object.keys(m.attrs).length === 0) delete m.attrs;
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
      if (!node.content || node.content.length === 0) return null;
    }
    if (node.marks) node.marks = sanitizeMarks(node.marks);

    if (node.attrs) {
      const allowed = new Set(ATTR_WHITELIST[node.type] || []);
      for (const k of Object.keys(node.attrs)) {
        const val = node.attrs[k];
        if (val === '' || val == null || !allowed.has(k)) delete node.attrs[k];
      }
      if (Object.keys(node.attrs).length === 0) delete node.attrs;
    }

    // ────── FIXED codeBlock: normalize newlines, keep single text node ──────
    if (node.type === 'codeBlock') {
      const textNode = node.content?.[0];
      if (textNode?.type === 'text') {
        textNode.text = textNode.text.replace(/\r\n?/g, '\n');
      }
      const lang = node.attrs?.language;
      if (!lang || !SAFE_LANGS.has(lang)) {
        delete node.attrs.language;
      }
    }
  }
  return node;
}

/* ──────────────────────────────────────────────── */
/* 4. Pre-parse cleanup & remark helpers            */
/* ──────────────────────────────────────────────── */
function preprocess(md: string): string {
  return md
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, (_, inner) => `\n\n\`\`\`\n${inner.trim()}\n\`\`\`\n\n`)
    .replace(
      /<procedure[^>]*id="([^"]*)"[^>]*title="([^"]*)"[^>]*>([\s\S]*?)<\/procedure>/gi,
      (_, id, title, inner) =>
        `\n\n@@PROCEDURE_BODY:${id}:${title}@@\n\n${inner.trim()}\n\n@@PROCEDURE_END@@\n\n`
    )
    .replace(
      /<include[^>]*from="([^"]*)"[^>]*element-id="([^"]*)".*?>/gi,
      (_, from, el) => `\n\n@@INCLUDE:${from}:${el}@@\n\n`
    )
    .replace(/<tabs[^>]*>([\s\S]*?)<\/tabs>/gi, (_, inner) => {
      const tabs = inner.match(/<tab[^>]*title="([^"]+)"[^>]*>([\s\S]*?)<\/tab>/gi);
      if (!tabs) return '\n\n@@TABS_EMPTY@@\n\n';
      const seq: string[] = ['@@TABS_START@@'];
      tabs.forEach((tab: string) => {
        const [, ttl, body] = /<tab[^>]*title="([^"]+)"[^>]*>([\s\S]*?)<\/tab>/i.exec(tab)!;
        seq.push(`@@TAB_TITLE:${ttl}@@`);
        seq.push(body.trim());
        seq.push('@@TAB_END@@');
      });
      seq.push('@@TABS_END@@');
      return `\n\n${seq.join('\n\n')}\n\n`;
    })
    .replace(/<seealso>([\s\S]*?)<\/seealso>/gi, (_, inner) => {
      const links = inner.match(/<a href="([^"]+)">([^<]+)<\/a>/gi) || [];
      const encoded = links.map((link: string) => {
        const [, href, text] = /<a href="([^"]+)">([^<]+)<\/a>/.exec(link)!;
        return `${href}|${text}`;
      }).join(';');
      return `\n\n@@SEEALSO:${encoded}@@\n\n`;
    })
    .replace(
      /<img([^>]*?)src=["']([^"']+)["']([^>]*?)alt=["']([^"']*)["']([^>]*?)\/?>/gi,
      (_, pre1, src, pre2, alt, post) => {
        const widthMatch = /width=["']?(\d+)/i.exec(pre1 + pre2 + post);
        const title = widthMatch ? ` "${JSON.stringify({ width: widthMatch[1] })}"` : '';
        return `\n\n![${alt}](${src}${title})\n\n`;
      }
    )
    .replace(/<code>([\s\S]*?)<\/code>/gi, (_, inner) => '`' + inner + '`')
    .replace(/<shortcut[^>]*>([\s\S]*?)<\/shortcut>/gi, (_, inner) => '`' + inner + '`')
    .replace(/<!--[\s\S]*?-->/g, '\n\n')
    .replace(/^\s*\{[^}]+\}\s*$/gm, '')
    .replace(/^(#{1,6} .+?)\n(?!\n)/gm, '$1\n\n')
    .replace(/<panel type="(\w+)">([\s\S]*?)<\/panel>/gi, (_, type, content) =>
      `\n\n@@PANEL:${type}:${content.trim()}@@\n\n`
    )
    .replace(/<taskList>([\s\S]*?)<\/taskList>/gi, (_, inner) => {
      const items = inner.match(/<taskItem state="(\w+)">([\s\S]*?)<\/taskItem>/gi) || [];
      const seq = ['@@TASK_START@@'];
      items.forEach((item: string) => {
        const [, state, content] = /<taskItem state="(\w+)">([\s\S]*?)<\/taskItem>/i.exec(item)!;
        seq.push(`@@TASK_ITEM:${state}:${content.trim()}@@`);
      });
      seq.push('@@TASK_END@@');
      return `\n\n${seq.join('\n')}\n\n`;
    })
    .replace(/<decisionList>([\s\S]*?)<\/decisionList>/gi, (_, inner) => {
      const items = inner.match(/<decisionItem>([\s\S]*?)<\/decisionItem>/gi) || [];
      const seq = ['@@DECISION_START@@'];
      items.forEach((item: string) => {
        const content = /<decisionItem>([\s\S]*?)<\/decisionItem>/i.exec(item)![1];
        seq.push(`@@DECISION_ITEM:${content.trim()}@@`);
      });
      seq.push('@@DECISION_END@@');
      return `\n\n${seq.join('\n')}\n\n`;
    })
    .replace(/<date timestamp="(\d+)"\s*\/>/gi, (_, timestamp) =>
      `\n\n@@DATE:${timestamp}@@\n\n`);
}

function remarkPreserveComments() {
  return (tree: any) => {
    visit(tree, 'html', (node: any, index?: number, parent?: any) => {
      if (!parent || !node.value.startsWith('<!--')) return;
      const content = node.value.replace(/^<!--|-->$/g, '').trim();
      parent.children.splice(index!, 1, {
        type: 'code',
        lang: 'comment',
        value: content,
      });
    });
  };
}

/* ──────────────────────────────────────────────── */
/* 5. Structural transforms (unchanged)            */
/* ──────────────────────────────────────────────── */

function walk(n: any, fn: (x: any, p?: any) => any, p?: any): any {
  const mapped = fn({ ...n }, p);
  if (mapped?.content) mapped.content = mapped.content
    .map((c: any) => walk(c, fn, mapped))
    .filter(Boolean);
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
  // Handle Writerside extensions
  if (node.type === 'paragraph' && node.content?.[0]?.text?.startsWith('@@PROCEDURE_BODY:')) {
    const [, id, title] = node.content[0].text.split(':');
    const body: any[] = [];
    let idx = parent!.content.indexOf(node) + 1;
    while (parent!.content[idx]?.content?.[0]?.text !== '@@PROCEDURE_END@@') {
      body.push(parent!.content.splice(idx, 1)[0]);
    }
    parent!.content.splice(idx, 1);
    return {
      type: 'bodiedExtension',
      attrs: {
        extensionType: 'com.writerside',
        extensionKey: 'procedure',
        parameters: { id, title },
      },
      content: body,
    };
  }

  // Handle tabs container
  if (node.type === 'paragraph' && node.content?.[0]?.text === '@@TABS_START@@') {
    const idxStart = parent!.content.indexOf(node);
    const tabBodies: any[] = [];
    const titles: string[] = [];

    let idx = idxStart + 1;
    while (parent!.content[idx]?.content?.[0]?.text !== '@@TABS_END@@') {
      const titlePar = parent!.content[idx];
      const match = titlePar?.content?.[0]?.text.match(/^@@TAB_TITLE:(.+)@@$/);
      if (match) {
        titles.push(match[1]);
        parent!.content.splice(idx, 1);
        const body: any[] = [];
        while (
          parent!.content[idx] &&
          !parent!.content[idx].content?.[0]?.text?.startsWith('@@TAB_') &&
          !parent!.content[idx].content?.[0]?.text?.startsWith('@@TABS_END@@')
        ) {
          body.push(parent!.content.splice(idx, 1)[0]);
        }
        if (parent!.content[idx]?.content?.[0]?.text === '@@TAB_END@@') {
          parent!.content.splice(idx, 1);
        }
        tabBodies.push({ type: 'extensionBody', content: body });
      } else {
        idx++;
      }
    }

    if (parent!.content[idx]?.content?.[0]?.text === '@@TABS_END@@') {
      parent!.content.splice(idx, 1);
    }
    parent!.content.splice(idxStart, 1);

    return {
      type: 'multiBodiedExtension',
      attrs: {
        extensionType: 'com.writerside',
        extensionKey: 'tabs',
        parameters: { titles },
      },
      content: tabBodies,
    };
  }

  // Handle inline placeholders
  if (node.type === 'paragraph' && node.content?.length === 1) {
    const text = node.content[0].text as string;

    if (text.startsWith('@@INCLUDE:')) {
      const [, from, elementId] = text.split(':');
      return {
        type: 'extension',
        attrs: {
          extensionType: 'com.writerside',
          extensionKey: 'include',
          parameters: { from, 'element-id': elementId },
        },
      };
    }

    if (text === '@@TABS_EMPTY@@') {
      return {
        type: 'multiBodiedExtension',
        attrs: {
          extensionType: 'com.writerside',
          extensionKey: 'tabs',
        },
        content: [],
      };
    }

    if (text.startsWith('@@SEEALSO:')) {
      const links = text.replace('@@SEEALSO:', '').split(';').map(pair => {
        const [href, label] = pair.split('|');
        return { href, label };
      });
      return {
        type: 'extension',
        attrs: {
          extensionType: 'com.writerside',
          extensionKey: 'seealso',
          parameters: { links },
        },
      };
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
      const timestamp = parseInt(text.replace('@@DATE:', ''), 10);
      return { type: 'date', attrs: { timestamp } };
    }
  }

  // Handle task lists
  if (node.type === 'paragraph' && node.content?.[0]?.text === '@@TASK_START@@') {
    const idxStart = parent!.content.indexOf(node);
    const items: any[] = [];

    let idx = idxStart + 1;
    while (parent!.content[idx]?.content?.[0]?.text !== '@@TASK_END@@') {
      const item = parent!.content[idx];
      if (item?.content?.[0]?.text?.startsWith('@@TASK_ITEM:')) {
        const [, state, content] = item.content[0].text.split(':');
        items.push({
          type: 'taskItem',
          attrs: {
            localId: `task-${items.length + 1}`,
            state: state === 'DONE' ? 'DONE' : 'TODO'
          },
          content: [{ type: 'text', text: content }]
        });
        parent!.content.splice(idx, 1);
      } else {
        idx++;
      }
    }

    parent!.content.splice(idx, 1); // Remove END marker
    parent!.content.splice(idxStart, 1); // Remove START marker

    return {
      type: 'taskList',
      content: items
    };
  }

  // Handle decision lists
  // Handle decision lists
  if (
    node.type === 'paragraph' &&
    node.content?.[0]?.text === '@@DECISION_START@@'
  ) {
    const idxStart = parent!.content.indexOf(node);
    const items: any[] = [];

    let idx = idxStart + 1;
    while (parent!.content[idx]?.content?.[0]?.text !== '@@DECISION_END@@') {
      const item = parent!.content[idx];
      if (item?.content?.[0]?.text?.startsWith('@@DECISION_ITEM:')) {
        const raw = item.content[0].text.replace('@@DECISION_ITEM:', '');
        items.push({
          type: 'decisionItem',
          attrs: { localId: `dec-${items.length + 1}` },
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: raw }]
            }
          ]
        });
        parent!.content.splice(idx, 1);          // remove processed marker
      } else {
        idx++;                                   // skip anything unexpected
      }
    }

    parent!.content.splice(idx, 1);              // remove @@DECISION_END@@
    parent!.content.splice(idxStart, 1);         // remove @@DECISION_START@@

    return { type: 'decisionList', content: items };
  }

  // Handle collapsible headings
  if (node.type === 'heading' && node.content?.[0]?.text) {
    const m = node.content[0].text.match(/^(.*)\s+\{collapsible="true"\}$/);
    if (m) {
      return {
        type: 'expand',
        attrs: { title: m[1] },
        content: [],
      };
    }
  }

  // Clean empty nodes
  if (node.type === 'paragraph' && (!node.content || node.content.length === 0)) return null;
  if (node.type === 'paragraph' &&
    node.content.every((c: any) => c.type === 'text') &&
    /^\{[^}]+\}$/.test(node.content.map((c: any) => c.text).join('').trim())
  ) {
    return null;
  }

  return node;
}
