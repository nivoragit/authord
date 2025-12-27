// tests/sync/confluence-sync_test.ts
import {
  assertEquals,
  assert,
} from "std/assert";

import { ConfluenceSync, type ConfluencePage, type ConfluenceFolder } from "../../lib/core/application/confluence_sync.ts";
import {
  asPageId,
  asStorageXhtml,
  type PageId,
  type Path,
  type StorageXhtml,
} from "../../lib/core/shared/types.ts";
import type {
  IPageRepository,
  IAttachmentRepository,
  IPropertyStore,
  AttachmentInfo,
} from "../../lib/core/ports/ports.ts";

// ---- Test fixtures -----------------------------------------------------------

const STORAGE_HTML: StorageXhtml = asStorageXhtml(String.raw`<div xmlns:ac="http://atlassian.com/content" xmlns:ri="http://atlassian.com/resource/identifier"><ac:structured-macro ac:name="toc" ac:schema-version="1" ac:macro-id="a854a720-dea6-4d0f-a0a2-e4591c07d85e"><ac:parameter ac:name="maxLevel">3</ac:parameter></ac:structured-macro><h1>Home</h1>
<p>This new paragraph includes <strong>bold</strong>, <em>italic</em>, <u>underline</u>, and <span style="text-decoration:line-through;">strikethrough</span>.</p>
<p>Here is a <a href="https://example.com">link</a>, an 😄, and a mention @Madushika Pramod</p>
<ul>
<li>Bullet list item 1</li>
<li>Bullet list item 2</li>
</ul>
<ol>
<li>Ordered list item 1</li>
<li>Ordered list item 2</li>
</ol>
<ul>
<li>[ ] Task list item</li>
</ul>
<blockquote>
<p><strong>Decision:</strong> Decision list item</p>
</blockquote>
<p>this table doesn't work</p>
<table><thead><tr><th>Header 1</th><th>Header 2</th></tr></thead><tbody><tr><td>Cell 1</td><td>Cell 2</td></tr></tbody></table>
<pre><code class="language-javascript">console.log('Hello, world!');
</code></pre>
<blockquote>
<p><strong>Info:</strong> This is an info panel.</p>
</blockquote>
<blockquote>
<p>This is a blockquote.</p>
</blockquote>
<hr/>
<blockquote>
<p><strong>Warning:</strong> This is a warning panel.</p>
</blockquote>
<blockquote>
<p><strong>Error:</strong> This is an error panel.</p>
</blockquote>
<p><strong>Date:</strong> 2025-06-15</p>
<h1>Diagram Examples</h1>
<p>This document demonstrates how to embed <strong>Mermaid</strong> diagrams in a Markdown file.</p>
<hr/>
<h2>Mermaid Flowchart</h2>
<p><ac:image ac:original-width="301" ac:original-height="396"><ri:attachment ri:filename="12b1ac49c.png"></ri:attachment></ac:image></p>
<h1>Child of Home</h1>
<p>This page is child of the home page.</p>
<h1>Page 2</h1>
<h2>Siblings</h2>
<p>This page is a root level page</p>
<!--Writerside adds this topic when you create a new documentation project.
You can use it as a sandbox to play with Writerside features, and remove it from the TOC when you don't need it anymore.-->
<h2>Add new topics</h2>
<p>You can create empty topics, or choose a template for different types of content that contains some boilerplate structure to help you get started:</p>
<p><ac:image ac:width="290" ac:thumbnail="true" ac:original-width="1284" ac:original-height="974"><ri:attachment ri:filename="new_topic_options.png"></ri:attachment></ac:image></p>
<h2>Write content</h2>
<p>%product% supports two types of markup: Markdown and XML.
When you create a new help article, you can choose between two topic types, but this doesn't mean you have to stick to a single format.
You can author content in Markdown and extend it with semantic attributes or inject entire XML elements.</p>
<h2>Inject XML</h2>
<p>For example, this is how you inject a procedure:</p>
<procedure title="Inject a procedure" id="inject-a-procedure">
    <step>
        <p>Start typing and select a procedure type from the completion suggestions:</p>
        @@ATTACH|file=completion_procedure.png@@
    </step>
    <step>
        <p>Press <shortcut>Tab</shortcut> or <shortcut>Enter</shortcut> to insert the markup.</p>
    </step>
</procedure>
<h2>Add interactive elements</h2>
<h3>Tabs</h3>
<p>To add switchable content, you can make use of tabs (inject them by starting to type <code>tab</code> on a new line):
<tabs>
<tab title="Markdown">
<code-block lang="plain text"><ac:image ac:width="450" ac:thumbnail="true" ac:original-width="1284" ac:original-height="974"><ri:attachment ri:filename="new_topic_options.png"></ri:attachment></ac:image></code-block>
</tab>
<tab title="Semantic markup">
<code-block lang="xml">
<!--[CDATA[@@ATTACH|file=new_topic_options.png|width=450@@]]--></code-block>
</tab>
</tabs></p>
<h3>Collapsible blocks</h3>
<p>Apart from injecting entire XML elements, you can use attributes to configure the behavior of certain elements.
For example, you can collapse a chapter that contains non-essential information:</p>
<h4>Supplementary info {collapsible="true"}</h4>
<p>Content under a collapsible header will be collapsed by default,
but you can modify the behavior by adding the following attribute:
<code>default-state="expanded"</code></p>
<h3>Convert selection to XML</h3>
<p>If you need to extend an element with more functions, you can convert selected content from Markdown to semantic markup.
For example, if you want to merge cells in a table, it's much easier to convert it to XML than do this in Markdown.
Position the caret anywhere in the table and press <shortcut>Alt+Enter</shortcut>:</p>
@@ATTACH|file=convert_table_to_xml.png|width=706@@
<h2>Feedback and support</h2>
<p>Please report any issues, usability improvements, or feature requests to our
<a href="https://youtrack.jetbrains.com/newIssue?project=WRS">YouTrack project</a>
(you will need to register).</p>
<p>You are welcome to join our
<a href="https://jb.gg/WRS_Slack">public Slack workspace</a>.
Before you do, please read our <a href="https://www.jetbrains.com/help/writerside/writerside-code-of-conduct.html">Code of conduct</a>.
We assume that you’ve read and acknowledged it before joining.</p>
<p>You can also always email us at <a href="mailto:writerside@jetbrains.com">writerside@jetbrains.com</a>.</p>
<seealso>
    <category ref="wrs">
        <a href="https://www.jetbrains.com/help/writerside/markup-reference.html">Markup reference</a>
        <a href="https://www.jetbrains.com/help/writerside/manage-table-of-contents.html">Reorder topics in the TOC</a>
        <a href="https://www.jetbrains.com/help/writerside/local-build.html">Build and publish</a>
        <a href="https://www.jetbrains.com/help/writerside/configure-search.html">Configure Search</a>
    </category>
</seealso></div>`);

// Helpers to brand strings for tests
const pid = (s: string) => asPageId(s);

// ---- Mocks -------------------------------------------------------------------

class MockPages implements IPageRepository {
  puts: Array<{ id: PageId; storage: StorageXhtml; title?: string }> = [];
  async get(): Promise<{ id: PageId; version: number; title: string } | null> {
    return { id: pid("P1"), version: 3, title: "T" };
  }
  async putStorageBody(pageId: PageId, storage: StorageXhtml, title?: string) {
    this.puts.push({ id: pageId, storage, title });
    return { id: pageId, version: this.puts.length };
  }
}

class MockAttachments implements IAttachmentRepository {
  ensured: Array<{ pageId: PageId; filePath: Path; contentType?: string }> = [];
  async list(): Promise<readonly AttachmentInfo[]> { return []; }
  async uploadOrHeal(): Promise<AttachmentInfo> { throw new Error("not used"); }
  async ensure(pageId: PageId, filePath: Path, contentType?: string): Promise<AttachmentInfo> {
    this.ensured.push({ pageId, filePath, contentType });
    return { id: "id", fileName: "fn", mediaType: contentType ?? "image/png" };
  }
}

class MockProps implements IPropertyStore {
  private store = new Map<string, string>();
  constructor(initial?: Record<string, string>) {
    for (const [k, v] of Object.entries(initial ?? {})) this.store.set(k, v);
  }
  async getExportHash(pageId: PageId): Promise<any | null> {
    return this.store.get(pageId as unknown as string) ?? null;
  }
  async setExportHash(pageId: PageId, hash: any): Promise<void> {
    this.store.set(pageId as unknown as string, String(hash));
  }
}

// ---- Tests -------------------------------------------------------------------

Deno.test("sync page: updates when hash changed and uploads attachments", async () => {
  const pages = new MockPages();
  const atts = new MockAttachments();
  const props = new MockProps(); // no prior hash => update expected
  const sync = new ConfluenceSync(pages, atts, props);

  const page: ConfluencePage = {
    title: "Home",
    storageHtml: STORAGE_HTML,
    attachments: [
      { filePath: "file:///abs/12b1ac49c.png" as unknown as Path, contentType: "image/png" },
      { filePath: "file:///abs/new_topic_options.png" as unknown as Path, contentType: "image/png" },
    ],
  };

  const res = await sync.sync(page, { pageId: pid("PAGE-1") });

  assert(res.updatedBody, "body should be updated");
  assertEquals(pages.puts.length, 1);
  assertEquals(pages.puts[0].title, "Home");
  assertEquals(atts.ensured.length, 2);
  assertEquals(res.uploadedAttachments.length, 2);
});

Deno.test("sync page: skips body update when hash matches; still ensures attachments", async () => {
  const nextHash = await ConfluenceSync.computeExportHash(STORAGE_HTML);
  const pages = new MockPages();
  const atts = new MockAttachments();
  const props = new MockProps({ "PAGE-2": nextHash });
  const sync = new ConfluenceSync(pages, atts, props);

  const page: ConfluencePage = {
    title: "Home",
    storageHtml: STORAGE_HTML,
    attachments: [{ filePath: "file:///abs/a.png" as unknown as Path }],
  };

  const res = await sync.sync(page, { pageId: pid("PAGE-2") });

  assertEquals(res.updatedBody, false);
  assertEquals(pages.puts.length, 0, "no put when hash unchanged");
  assertEquals(atts.ensured.length, 1, "attachments still ensured");
});

Deno.test("sync folder: resolves child pages and syncs hierarchy", async () => {
  const pages = new MockPages();
  const atts = new MockAttachments();
  const props = new MockProps(); // force updates

  const sync = new ConfluenceSync(pages, atts, props);

  const folder: ConfluenceFolder = {
    title: "Docs",
    pages: [
      { title: "Home", storageHtml: STORAGE_HTML },
      { title: "Page 2", storageHtml: STORAGE_HTML },
    ],
    children: [
      {
        title: "Guides",
        pages: [{ title: "Getting Started", storageHtml: STORAGE_HTML }],
      },
    ],
  };

  const resolver = async ({ parentId, childTitle }: { parentId: PageId; childTitle: string }) => {
    // Simple deterministic mapping for tests
    return pid(`${parentId as unknown as string}/${childTitle}`);
  };

  const out = await sync.syncFolder(folder, { parentId: pid("ROOT"), resolveChildPageId: resolver });

  // Expect 3 puts (Home, Page 2, Getting Started)
  assertEquals(pages.puts.length, 3);
  assertEquals(Object.keys(out.pages).length, 2);
  assertEquals(Object.keys(out.children).length, 1);
  assert(out.children["Guides"] !== undefined);
});
