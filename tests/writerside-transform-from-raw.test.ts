// writerside-transform-from-raw.test.ts
import { WritersideMarkdownTransformerDC } from "../lib/writerside-markdown-transformer.ts";

// Tiny helper
function expectIncludes(haystack: string, needles: string[], ctx = "output") {
  for (const n of needles) {
    if (!haystack.includes(n)) {
      throw new Error(`Expected ${ctx} to include:\n${n}\n\nGot:\n${haystack}`);
    }
  }
}

// 1) TOC + first H1 (Home)
Deno.test("doc: TOC macro injected before first H1", async () => {
  const md = "# Home\n";
  const t = new WritersideMarkdownTransformerDC();
  const s = (await t.toStorage(md)).value;
  expectIncludes(s, [
    'xmlns:ac="http://atlassian.com/content"',
    'xmlns:ri="http://atlassian.com/resource/identifier"',
    '<ac:structured-macro ac:name="toc"',
    "<h1>Home</h1>",
  ]);
});

// 2) Inline formatting (bold, italic, underline html, strike -> span style)
Deno.test("inline: bold/italic/underline/strike (span-style strike)", async () => {
  const md = "This has **bold**, _italic_, <u>underline</u>, and ~~strikethrough~~.";
  const t = new WritersideMarkdownTransformerDC();
  const s = (await t.toStorage(md)).value;
  expectIncludes(s, [
    "<strong>bold</strong>",
    "<em>italic</em>",
    "<u>underline</u>",
    '<span style="text-decoration:line-through;">strikethrough</span>',
  ]);
});

// 3) Link + emoji + mention
Deno.test("inline: link + emoji + mention", async () => {
  const md = "Here is a [link](https://example.com), an 😄, and a mention @Madushika Pramod";
  const t = new WritersideMarkdownTransformerDC();
  const s = (await t.toStorage(md)).value;
  expectIncludes(s, [
    '<a href="https://example.com">link</a>',
    "😄",
    "mention @Madushika Pramod",
  ]);
});

// 4) Unordered list
Deno.test("list: unordered", async () => {
  const md = "- Bullet list item 1\n- Bullet list item 2";
  const t = new WritersideMarkdownTransformerDC();
  const s = (await t.toStorage(md)).value;
  expectIncludes(s, ["<ul>", "<li>Bullet list item 1</li>", "<li>Bullet list item 2</li>", "</ul>"]);
});

// 5) Ordered list
Deno.test("list: ordered", async () => {
  const md = "1. Ordered list item 1\n2. Ordered list item 2";
  const t = new WritersideMarkdownTransformerDC();
  const s = (await t.toStorage(md)).value;
  expectIncludes(s, ["<ol>", "<li>Ordered list item 1</li>", "<li>Ordered list item 2</li>", "</ol>"]);
});

// 6) Task list literal
Deno.test("list: task list literal preserved", async () => {
  const md = "- [ ] Task list item";
  const t = new WritersideMarkdownTransformerDC();
  const s = (await t.toStorage(md)).value;
  // Expected shows literal [ ] preserved inside <li>
  expectIncludes(s, ["<ul>", "<li>[ ] Task list item</li>", "</ul>"]);
});

// 7) Decision blockquote
Deno.test("blockquote: Decision label", async () => {
  const md = "> **Decision:** Decision list item";
  const t = new WritersideMarkdownTransformerDC();
  const s = (await t.toStorage(md)).value;
  expectIncludes(s, ["<blockquote>", "<strong>Decision:</strong> Decision list item", "</blockquote>"]);
});

// 8) Table
Deno.test("table: GFM 2x2", async () => {
  const md =
    "| Header 1 | Header 2 |\n| -------- | -------- |\n| Cell 1   | Cell 2   |";
  const t = new WritersideMarkdownTransformerDC();
  const s = (await t.toStorage(md)).value;
  expectIncludes(s, [
    "<table>",
    "<thead><tr><th>Header 1</th><th>Header 2</th></tr></thead>",
    "<tbody><tr><td>Cell 1</td><td>Cell 2</td></tr></tbody>",
    "</table>",
  ]);
});

// 9) Fenced code with language
Deno.test("code: fenced js becomes pre/code with language class", async () => {
  const md = "```javascript\nconsole.log('Hello, world!');\n```";
  const t = new WritersideMarkdownTransformerDC();
  const s = (await t.toStorage(md)).value;
  expectIncludes(s, [
    '<pre><code class="language-javascript">console.log(\'Hello, world!\');\n</code></pre>',
  ]);
});

// 10) Info/Warning/Error panels (rendered as blockquotes with strong label)
for (const kind of ["Info", "Warning", "Error"] as const) {
  Deno.test(`blockquote: ${kind} label`, async () => {
    const md = `> **${kind}:** This is a ${kind.toLowerCase()} panel.`;
    const t = new WritersideMarkdownTransformerDC();
    const s = (await t.toStorage(md)).value;
    expectIncludes(s, ["<blockquote>", `<strong>${kind}:</strong> This is a ${kind.toLowerCase()} panel.`, "</blockquote>"]);
  });
}

// 11) Plain blockquote
Deno.test("blockquote: plain", async () => {
  const md = "> This is a blockquote.";
  const t = new WritersideMarkdownTransformerDC();
  const s = (await t.toStorage(md)).value;
  expectIncludes(s, ["<blockquote>", "<p>This is a blockquote.</p>", "</blockquote>"]);
});

// 12) Horizontal rule
Deno.test("hr: thematic break", async () => {
  const md = "---";
  const t = new WritersideMarkdownTransformerDC();
  const s = (await t.toStorage(md)).value;
  expectIncludes(s, ["<hr/>"]);
});

// 13) Labeled date
Deno.test("inline: labeled date strong", async () => {
  const md = "**Date:** 2025-06-15";
  const t = new WritersideMarkdownTransformerDC();
  const s = (await t.toStorage(md)).value;
  expectIncludes(s, ["<p><strong>Date:</strong> 2025-06-15</p>"]);
});


// 15) H1 “Child of Home” + paragraph
Deno.test("headings: Child of Home h1 + paragraph", async () => {
  const md = "# Child of Home\n\nThis page is child of the home page.";
  const t = new WritersideMarkdownTransformerDC();
  const s = (await t.toStorage(md)).value;
  expectIncludes(s, ["<h1>Child of Home</h1>", "<p>This page is child of the home page.</p>"]);
});

// 16) Page 2 + Siblings section
Deno.test("headings: Page 2 + Siblings", async () => {
  const md = "# Page 2\n\n## Siblings\n\nThis page is a root level page";
  const t = new WritersideMarkdownTransformerDC();
  const s = (await t.toStorage(md)).value;
  expectIncludes(s, ["<h1>Page 2</h1>", "<h2>Siblings</h2>", "<p>This page is a root level page</p>"]);
});

// 17) HTML comment preserved
Deno.test("html: comment preserved", async () => {
  const md = "<!--Writerside adds this topic when you create a new documentation project.\nYou can use it as a sandbox to play with Writerside features, and remove it from the TOC when you don't need it anymore.-->";
  const t = new WritersideMarkdownTransformerDC();
  const s = (await t.toStorage(md)).value;
  // Expect the literal comment in output
  expectIncludes(s, ["<!--Writerside adds this topic when you create a new documentation project.", "don't need it anymore.-->"]);
});

// 18) Markdown image with width + border-effect → ac:image with attrs
Deno.test("image: width + border-effect → ac:image width + thumbnail", async () => {
  const md = "![Create new topic options](new_topic_options.png){ width=290 }{border-effect=line}";
  const t = new WritersideMarkdownTransformerDC();
  const s = (await t.toStorage(md)).value;
  expectIncludes(s, [
    "<ac:image",
    'ri:filename="new_topic_options.png"',
    'ac:width="290"',
    'ac:thumbnail="true"',
    "</ac:image>",
  ]);
});

// 19) Procedure XML with inner <img …> → @@ATTACH
Deno.test("xml: procedure inner image becomes @@ATTACH", async () => {
  const md =
`<procedure title="Inject a procedure" id="inject-a-procedure">
    <step>
        <p>Start typing and select a procedure type from the completion suggestions:</p>
        <img src="completion_procedure.png" alt="completion suggestions for procedure" border-effect="line"/>
    </step>
    <step>
        <p>Press <shortcut>Tab</shortcut> or <shortcut>Enter</shortcut> to insert the markup.</p>
    </step>
</procedure>`;
  const t = new WritersideMarkdownTransformerDC();
  const s = (await t.toStorage(md)).value;
  expectIncludes(s, [
    "<procedure title=\"Inject a procedure\" id=\"inject-a-procedure\">",
    "@@ATTACH|file=completion_procedure.png@@",
    "</procedure>",
  ]);
});


// 21) Collapsible header literal suffix
Deno.test("headers: collapsible suffix preserved literally", async () => {
  const md = "#### Supplementary info {collapsible=\"true\"}";
  const t = new WritersideMarkdownTransformerDC();
  const s = (await t.toStorage(md)).value;
  expectIncludes(s, ['<h4>Supplementary info {collapsible="true"}</h4>']);
});

// 22) Convert selection image → @@ATTACH with width
Deno.test("xml-ish: convert selection image → @@ATTACH|width", async () => {
  const md = '<img src="convert_table_to_xml.png" alt="Convert table to XML" width="706" border-effect="line"/>';
  const t = new WritersideMarkdownTransformerDC();
  const s = (await t.toStorage(md)).value;
  expectIncludes(s, ["@@ATTACH|file=convert_table_to_xml.png|width=706@@"]);
});

// 23) Feedback/support links preserved
Deno.test("links: feedback/support anchors intact", async () => {
  const md =
`Please report issues to our <a href="https://youtrack.jetbrains.com/newIssue?project=WRS">YouTrack project</a>.
Join <a href="https://jb.gg/WRS_Slack">public Slack workspace</a>.
Read <a href="https://www.jetbrains.com/help/writerside/writerside-code-of-conduct.html">Code of conduct</a>.
Email <a href="mailto:writerside@jetbrains.com">writerside@jetbrains.com</a>.`;
  const t = new WritersideMarkdownTransformerDC();
  const s = (await t.toStorage(md)).value;
  expectIncludes(s, [
    'href="https://youtrack.jetbrains.com/newIssue?project=WRS"',
    'href="https://jb.gg/WRS_Slack"',
    'href="https://www.jetbrains.com/help/writerside/writerside-code-of-conduct.html"',
    'href="mailto:writerside@jetbrains.com"',
  ]);
});

// 24) Seealso block preserved
Deno.test("seealso: category + links preserved", async () => {
  const md =
`<seealso>
    <category ref="wrs">
        <a href="https://www.jetbrains.com/help/writerside/markup-reference.html">Markup reference</a>
        <a href="https://www.jetbrains.com/help/writerside/manage-table-of-contents.html">Reorder topics in the TOC</a>
        <a href="https://www.jetbrains.com/help/writerside/local-build.html">Build and publish</a>
        <a href="https://www.jetbrains.com/help/writerside/configure-search.html">Configure Search</a>
    </category>
</seealso>`;
  const t = new WritersideMarkdownTransformerDC();
  const s = (await t.toStorage(md)).value;
  expectIncludes(s, [
    "<seealso>",
    '<category ref="wrs">',
    'href="https://www.jetbrains.com/help/writerside/markup-reference.html"',
    'href="https://www.jetbrains.com/help/writerside/manage-table-of-contents.html"',
    'href="https://www.jetbrains.com/help/writerside/local-build.html"',
    'href="https://www.jetbrains.com/help/writerside/configure-search.html"',
    "</seealso>",
  ]);
});

// 25) Wrapper namespaces always present
Deno.test("doc: root wrapper with ac/ri namespaces present", async () => {
  const md = "Just a line.";
  const t = new WritersideMarkdownTransformerDC();
  const s = (await t.toStorage(md)).value;
  expectIncludes(s, [
    "<div ",
    'xmlns:ac="http://atlassian.com/content"',
    'xmlns:ri="http://atlassian.com/resource/identifier"',
  ]);
});


// 29) Basic image without attributes -> ac:image attachment
Deno.test("image: basic without attrs -> ac:image attachment", async () => {
  const md = "![Alt](assets/pic.png)";
  const t = new WritersideMarkdownTransformerDC();
  const s = (await t.toStorage(md)).value;
  expectIncludes(s, [
    "<ac:image",
    'ri:filename="pic.png"',
    "</ac:image>",
  ]);
});


async function storageToString(
  t: WritersideMarkdownTransformerDC,
  md: string
): Promise<string> {
  const out: any = await t.toStorage(md);
  // Try obvious string routes first
  if (typeof out === "string") return out;
  if (out && typeof out.toString === "function") {
    const s = out.toString();
    if (typeof s === "string" && s !== "[object Object]") return s;
  }
  // Common file/virtual-file shapes
  if (out && (out.value !== undefined || out.contents !== undefined)) {
    return String(out.value ?? out.contents);
  }
  // Last resort
  return String(out);
}



// 14) Mermaid → remains a mermaid code block when images dir missing
Deno.test(
  'mermaid: fenced block stays <pre><code class="language-mermaid"> when images dir missing',
  async () => {
    const md =
      "```mermaid\ngraph TD\n    A[Start] --> B{Is it working?}\n    B -- Yes --> C[Keep going]\n    B -- No --> D[Fix it]\n    D --> B\n```";
    const t = new WritersideMarkdownTransformerDC();;
    const s = await storageToString(t, md);
    expectIncludes(s, [
      '<pre><code class="language-mermaid">graph TD',
      "A[Start] --> B{Is it working?}",
      "B -- Yes --> C[Keep going]",
      "B -- No --> D[Fix it]",
      "D --> B",
      "</code></pre>",
    ]);
  }
);

// 20) Tabs: markdown code stays literal; xml tab emits @@ATTACH CDATA
Deno.test(
  "tabs: markdown code keeps literal image; xml tab uses @@ATTACH in commented CDATA",
  async () => {
    const md = `<tabs>
    <tab title="Markdown">
        <code-block lang="plain text">![Alt Text](new_topic_options.png){ width=450 }</code-block>
    </tab>
    <tab title="Semantic markup">
        <code-block lang="xml">
            <![CDATA[<img src="new_topic_options.png" alt="Alt text" width="450px"/>]]></code-block>
    </tab>
</tabs>`;
    const t = new WritersideMarkdownTransformerDC();;
    const s = await storageToString(t, md);
    // markdown tab — stays literal
    expectIncludes(s, [
      '<tab title="Markdown">',
      '<code-block lang="plain text">![Alt Text](new_topic_options.png){ width=450 }</code-block>',
    ]);
    // xml tab — commented CDATA with @@ATTACH
    expectIncludes(s, [
      '<tab title="Semantic markup">',
      '<code-block lang="xml">',
      "<!--[CDATA[@@ATTACH|file=new_topic_options.png|width=450@@]]-->",
    ]);
  }
);
// 26) Image trailing attrs: not parsed (current behavior); braces show as text
Deno.test(
  "image: trailing attrs are not parsed; image rendered + literal {width ... height=...}",
  async () => {
    const md = "![logo](images/logo.png) {width:100px height=200}";
    const t = new WritersideMarkdownTransformerDC();;
    const s = await storageToString(t, md);
    // ac:image is produced
    expectIncludes(s, [
      "<ac:image",
      'ri:filename="logo.png"',
      "</ac:image>",
    ]);
    // trailing attrs appear as literal text; keep assertions loose to avoid brittle whitespace
    expectIncludes(s, [
      "{width",        // literal start
      "<div></div>",   // inserted empty div (per current pipeline)
      "height=200}",   // literal end
    ]);
  }
);
// 27) Mermaid deterministic filename test → also code block when images dir missing
Deno.test(
  "mermaid: when images dir missing, remains a mermaid code block (no ac:image)",
  async () => {
    const md = "```mermaid\ngraph TD; A-->B;\n```";
    const t = new WritersideMarkdownTransformerDC();;
    const s = await storageToString(t, md);
    expectIncludes(s, [
      '<pre><code class="language-mermaid">graph TD; A-->B;',
      "</code></pre>",
    ]);
  }
);
// 28) Strikethrough uses styled <span>; raw HTML passthrough
Deno.test(
  "inline: GFM strike -> styled <span>; raw HTML passthrough",
  async () => {
    const md = '~~old~~ and <span class="x">ok</span>';
    const t = new WritersideMarkdownTransformerDC();;
    const s = await storageToString(t, md);
    expectIncludes(s, [
      '<span style="text-decoration:line-through;">old</span>',
      '<span class="x">ok</span>',
    ]);
  }
);
