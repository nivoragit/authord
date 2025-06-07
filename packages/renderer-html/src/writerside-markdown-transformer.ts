// src/utils/writerside-markdown-transformer.ts

import { MarkdownTransformer } from '@atlaskit/editor-markdown-transformer';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkDirective from 'remark-directive';
import remarkStringify from 'remark-stringify';
import { visit } from 'unist-util-visit';
import { Node as PMNode, Schema } from 'prosemirror-model';
import { defaultSchema } from '@atlaskit/adf-schema/schema-default';

/**
 * WritersideMarkdownTransformer
 * — fully updated for:
 *   • true heading separation
 *   • placeholders → extension / bodiedExtension / multiBodiedExtension
 *   • comments preserved as code blocks (language: "comment")
 *   • CDATA captured
 *   • <seealso> lists → seealso extension
 *   • collapsible headings → expand nodes (collapsed by default)
 *   • stray empty paragraphs removed
 *   • inline <code>/<shortcut> converted to code marks
 *   • <tabs> containers mapped to multiBodiedExtension
 */
export class WritersideMarkdownTransformer extends MarkdownTransformer {
  override parse(markdown: string): PMNode {
    const cleaned = preprocess(markdown);
    const roundtripped = unified()
      .use(remarkParse)
      .use(remarkPreserveComments)
      .use(remarkDirective)
      .use(remarkStringify as any)
      .processSync(cleaned)
      .toString();

    // 1) Parse to JSON, inject required version, strip top-level empties
    const baseJson: any = super.parse(roundtripped).toJSON();
    baseJson.version = 1;
    baseJson.content = baseJson.content.filter(
      (n: any) => !(n.type === 'paragraph' && (!n.content || n.content.length === 0))
    );

    // 2) Group expand content and apply transforms
    const nested = groupExpandContent(baseJson);
    const finalJson = walk(nested, transformNode);

    // 3) Return as ProseMirror Node
    return PMNode.fromJSON(defaultSchema as unknown as Schema, finalJson);
  }
}

/* ──────────────────────────────────────────────────────────────────────────── */
/* 1) Preprocess raw Markdown                                                  */
/* ──────────────────────────────────────────────────────────────────────────── */
function preprocess(md: string): string {
  return md
    // CDATA → fenced code block
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, (_m, inner) =>
      `\n\n\`\`\`\n${inner.trim()}\n\`\`\`\n\n`
    )
    // <procedure> … </procedure> → BODY placeholder sequence
    .replace(
      /<procedure[^>]*id="([^"]*)"[^>]*title="([^"]*)"[^>]*>([\s\S]*?)<\/procedure>/gi,
      (_m, id, title, inner) =>
        `\n\n@@PROCEDURE_BODY:${id}:${title}@@\n\n${inner.trim()}\n\n@@PROCEDURE_END@@\n\n`
    )
    // <include> → placeholder
    .replace(
      /<include[^>]*from="([^"]*)"[^>]*element-id="([^"]*)".*?>/gi,
      (_m, from, el) => `\n\n@@INCLUDE:${from}:${el}@@\n\n`
    )
    // <tabs> … </tabs> → placeholders for multiBodiedExtension
    .replace(/<tabs[^>]*>([\s\S]*?)<\/tabs>/gi, (_m, inner) => {
      const tabs = inner.match(/<tab[^>]*title="([^"]+)"[^>]*>([\s\S]*?)<\/tab>/gi);
      if (!tabs) return '\n\n@@TABS_EMPTY@@\n\n';
      const seq: string[] = ['@@TABS_START@@'];
      tabs.forEach((tab: string) => {
        const [, ttl, body] =
          /<tab[^>]*title="([^"]+)"[^>]*>([\s\S]*?)<\/tab>/i.exec(tab)!;
        seq.push(`@@TAB_TITLE:${ttl}@@`);
        seq.push(body.trim());
        seq.push('@@TAB_END@@');
      });
      seq.push('@@TABS_END@@');
      return `\n\n${seq.join('\n\n')}\n\n`;
    })
    // <seealso> … </seealso> → placeholder
    .replace(/<seealso>([\s\S]*?)<\/seealso>/gi, (_m, inner) => {
      const encoded = inner
        .match(/<a href="([^"]+)">([^<]+)<\/a>/gi)!
        .map((link: string) => {
          const [, href, text] = /<a href="([^"]+)">([^<]+)<\/a>/.exec(link)!;
          return `${href}|${text}`;
        })
        .join(';');
      return `\n\n@@SEEALSO:${encoded}@@\n\n`;
    })
    // <img> tags → Markdown images (width preserved via title attribute)
    .replace(
      /<img([^>]*?)src=["']([^"']+)["']([^>]*?)alt=["']([^"']*)["']([^>]*?)\/?>/gi,
      (_m, pre1, src, pre2, alt, post) => {
        const widthMatch = /width=["']?(\d+)/i.exec(pre1 + pre2 + post);
        const title = widthMatch ? ` "${JSON.stringify({ width: widthMatch[1] })}"` : '';
        return `\n\n![${alt}](${src}${title})\n\n`;
      }
    )
    // inline <code> and <shortcut> → back-tick code
    .replace(/<code>([\s\S]*?)<\/code>/gi, (_m, inner) => '`' + inner + '`')
    .replace(/<shortcut[^>]*>([\s\S]*?)<\/shortcut>/gi, (_m, inner) => '`' + inner + '`')
    // HTML comments → blank lines (handled later by plugin)
    .replace(/<!--[\s\S]*?-->/g, '\n\n')
    // Drop attribute-only braces
    .replace(/^\s*\{[^}]+\}\s*$/gm, '')
    // Ensure blank line after headings
    .replace(/^(#{1,6} .+?)\n(?!\n)/gm, '$1\n\n');
}

/* ──────────────────────────────────────────────────────────────────────────── */
/* 2) Remark plugin: preserve HTML comments as code blocks (lang: "comment")   */
/* ──────────────────────────────────────────────────────────────────────────── */
function remarkPreserveComments() {
  return (tree: any) => {
    visit(tree, 'html', (node: any, index?: number, parent?: any): void => {
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

/* ──────────────────────────────────────────────────────────────────────────── */
/* 3) Walk ADF JSON and apply transformNode to every node                      */
/* ──────────────────────────────────────────────────────────────────────────── */
function walk(n: any, fn: (x: any, parent?: any) => any, parent?: any): any {
  const mapped = fn({ ...n }, parent);
  if (mapped && mapped.content) {
    mapped.content = mapped.content
      .map((c: any) => walk(c, fn, mapped))
      .filter(Boolean);
  }
  return mapped;
}

/* ──────────────────────────────────────────────────────────────────────────── */
/* 4) Post-process: group paragraphs under expand nodes                        */
/* ──────────────────────────────────────────────────────────────────────────── */
function groupExpandContent(doc: any): any {
  for (let i = 0; i < doc.content.length - 1; i++) {
    const node = doc.content[i];
    const next = doc.content[i + 1];
    if (node.type === 'expand' && next.type === 'paragraph') {
      node.content = next.content;
      doc.content.splice(i + 1, 1);
    }
  }
  return doc;
}

/* ──────────────────────────────────────────────────────────────────────────── */
/* 5) transformNode: convert placeholders, clean empties, etc.                 */
/* ──────────────────────────────────────────────────────────────────────────── */
function transformNode(node: any, parent?: any): any {
  /* ──────────── Bodied procedure ──────────── */
  if (
    node.type === 'paragraph' &&
    node.content?.[0]?.text?.startsWith('@@PROCEDURE_BODY:')
  ) {
    const [, id, title] = node.content[0].text.split(':');
    const body: any[] = [];
    let idx = parent!.content.indexOf(node) + 1;
    while (
      parent!.content[idx]?.content?.[0]?.text !== '@@PROCEDURE_END@@'
    ) {
      body.push(parent!.content.splice(idx, 1)[0]);
    }
    parent!.content.splice(idx, 1); // remove END marker
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

  /* ──────────── Tabs container (multiBodiedExtension) ──────────── */
  if (
    node.type === 'paragraph' &&
    node.content?.[0]?.text === '@@TABS_START@@'
  ) {
    const idxStart = parent!.content.indexOf(node);
    const tabBodies: any[] = [];
    const titles: string[] = [];

    // Walk forward, collect titles and their bodies
    let idx = idxStart + 1;
    while (
      parent!.content[idx] &&
      parent!.content[idx].content?.[0]?.text !== '@@TABS_END@@'
    ) {
      // title placeholder
      const titlePar = parent!.content[idx];
      const match = titlePar?.content?.[0]?.text.match(/^@@TAB_TITLE:(.+)@@$/);
      if (match) {
        titles.push(match[1]);
        parent!.content.splice(idx, 1); // remove title placeholder
        const body: any[] = [];
        // collect until TAB_END or next title/TABS_END
        while (
          parent!.content[idx] &&
          !(
            parent!.content[idx].content?.[0]?.text?.startsWith('@@TAB_TITLE:') ||
            parent!.content[idx].content?.[0]?.text === '@@TAB_END@@' ||
            parent!.content[idx].content?.[0]?.text === '@@TABS_END@@'
          )
        ) {
          body.push(parent!.content.splice(idx, 1)[0]);
        }
        if (
          parent!.content[idx]?.content?.[0]?.text === '@@TAB_END@@'
        ) {
          parent!.content.splice(idx, 1); // remove TAB_END
        }
        tabBodies.push({ type: 'extensionBody', content: body });
      } else {
        // Safety valve: skip
        idx++;
      }
    }

    // remove @@TABS_END@@
    if (
      parent!.content[idx] &&
      parent!.content[idx].content?.[0]?.text === '@@TABS_END@@'
    ) {
      parent!.content.splice(idx, 1);
    }
    // remove @@TABS_START@@ (it is current node)
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

  /* ──────────── Inline placeholders ──────────── */
  if (node.type === 'paragraph' && node.content?.length === 1) {
    const text = node.content[0].text as string;

    // Procedure (inline, very rare)
    const procMatch = text.match(/^@@PROCEDURE:([^:]+):(.+?)@@$/);
    if (procMatch) {
      const [, id, title] = procMatch;
      return {
        type: 'extension',
        attrs: {
          extensionType: 'com.writerside',
          extensionKey: 'procedure',
          parameters: { id, title },
        },
      };
    }

    // Include
    const includeMatch = text.match(/^@@INCLUDE:([^:]+):([^:]+)@@$/);
    if (includeMatch) {
      const [, from, elementId] = includeMatch;
      return {
        type: 'extension',
        attrs: {
          extensionType: 'com.writerside',
          extensionKey: 'include',
          parameters: { from, 'element-id': elementId },
        },
      };
    }

    // Empty tabs (edge case)
    if (text.trim() === '@@TABS_EMPTY@@') {
      return {
        type: 'multiBodiedExtension',
        attrs: {
          extensionType: 'com.writerside',
          extensionKey: 'tabs',
        },
        content: [],
      };
    }

    // See-also placeholder
    const seeMatch = text.match(/^@@SEEALSO:(.+)@@$/);
    if (seeMatch) {
      const links = seeMatch[1].split(';').map((pair) => {
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
  }

  /* ──────────── Collapsible headings → expand ──────────── */
  if (node.type === 'heading' && node.content?.[0]?.text) {
    const m = node.content[0].text.match(/^(.*)\s+\{collapsible="true"\}$/);
    if (m) {
      return {
        type: 'expand',
        attrs: { title: m[1] }, // collapsed by default (no expanded attr)
        content: [],
      };
    }
  }

  /* ──────────── Code blocks: ensure language / comment marker ──────────── */
  if (node.type === 'codeBlock') {
    return {
      type: 'codeBlock',
      attrs: { language: node.attrs?.language ?? '' },
      content: node.content,
    };
  }

  /* ──────────── Strip empty paragraphs anywhere ──────────── */
  if (node.type === 'paragraph' && (!node.content || node.content.length === 0))
    return null;

  /* ──────────── Strip attribute-only paragraphs ──────────── */
  if (
    node.type === 'paragraph' &&
    node.content?.every((c: any) => c.type === 'text') &&
    /^\{[^}]+\}$/.test(node.content.map((c: any) => c.text).join('').trim())
  ) {
    return null;
  }

  return node;
}
