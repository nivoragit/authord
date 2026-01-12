import { WritersideMarkdownTransformer } from "@authord/render-core/writerside_markdown_transformer.ts";

function expectIncludes(haystack: string, needles: string[], ctx = "output") {
  for (const n of needles) {
    if (!haystack.includes(n)) {
      throw new Error(`Expected ${ctx} to include:\n${n}\n\nGot:\n${haystack}`);
    }
  }
}

async function storageToString(
  t: WritersideMarkdownTransformer,
  md: string,
): Promise<string> {
  const out: any = await t.toStorage(md);
  if (typeof out === "string") return out;
  if (out && typeof out.toString === "function") {
    const s = out.toString();
    if (typeof s === "string" && s !== "[object Object]") return s;
  }
  if (out && (out.value !== undefined || out.contents !== undefined)) {
    return String(out.value ?? out.contents);
  }
  return String(out);
}

Deno.test("writerside: show-structure inserts TOC macro", async () => {
  const md = '<show-structure for="chapter" depth="2"/>';
  const t = new WritersideMarkdownTransformer(".");
  const s = await storageToString(t, md);
  expectIncludes(s, [
    'ac:name="toc"',
    '<ac:parameter ac:name="maxLevel">2</ac:parameter>',
  ]);
  if (s.includes("<show-structure")) {
    throw new Error("Expected <show-structure> to be removed in output");
  }
});

Deno.test("writerside: code-block becomes Confluence code macro", async () => {
  const md = '<code-block lang="bash">echo "example"</code-block>';
  const t = new WritersideMarkdownTransformer(".");
  const s = await storageToString(t, md);
  expectIncludes(s, [
    'ac:name="code"',
    '<ac:parameter ac:name="language">bash</ac:parameter>',
    '<ac:plain-text-body><![CDATA[echo "example"]]></ac:plain-text-body>',
  ]);
});

Deno.test("writerside: compare becomes section/column layout", async () => {
  const md = `<compare first-title="First Column" second-title="Second Column">
    <code-block lang="bash">
    echo "first"
    </code-block>
    <code-block lang="bash">
    echo "second"
    </code-block>
  </compare>`;
  const t = new WritersideMarkdownTransformer(".");
  const s = await storageToString(t, md);
  expectIncludes(s, [
    'ac:name="section"',
    'ac:name="column"',
    "<h4>First Column</h4>",
    "<h4>Second Column</h4>",
    'ac:name="code"',
    'echo "first"',
    'echo "second"',
  ]);
});

Deno.test("writerside: list type=bullet renders ul", async () => {
  const md = `<list type="bullet">
  <li><p>Bullet item</p></li>
</list>`;
  const t = new WritersideMarkdownTransformer(".");
  const s = await storageToString(t, md);
  expectIncludes(s, ["<ul type=\"bullet\">", "<li><p>Bullet item</p></li>", "</ul>"]);
  if (s.includes("<list")) {
    throw new Error("Expected <list> tag to be converted to <ul>");
  }
});

Deno.test("writerside: list type=decimal renders ol", async () => {
  const md = '<list type="decimal"><li><p>Numbered item</p></li></list>';
  const t = new WritersideMarkdownTransformer(".");
  const s = await storageToString(t, md);
  expectIncludes(s, ["<ol>", "<li><p>Numbered item</p></li>", "</ol>"]);
});

Deno.test("writerside: list default renders ul", async () => {
  const md = "<list><li><p>Default list item</p></li></list>";
  const t = new WritersideMarkdownTransformer(".");
  const s = await storageToString(t, md);
  expectIncludes(s, ["<ul>", "<li><p>Default list item</p></li>", "</ul>"]);
});

Deno.test("writerside: procedure becomes heading + ordered list", async () => {
  const md = `<procedure title="Procedure Title" id="procedure-id">
  <step>
    <p>Do the thing.</p>
  </step>
</procedure>`;
  const t = new WritersideMarkdownTransformer(".");
  const s = await storageToString(t, md);
  expectIncludes(s, [
    '<h3 id="procedure-id">Procedure Title</h3>',
    "<ol>",
    "<li>",
    "<p>Do the thing.</p>",
    "</ol>",
  ]);
});

Deno.test("writerside: tabs become expand macros", async () => {
  const md = '<tabs><tab title="Tab Title"><p>Tab content.</p></tab></tabs>';
  const t = new WritersideMarkdownTransformer(".");
  const s = await storageToString(t, md);
  expectIncludes(s, [
    'ac:name="expand"',
    '<ac:parameter ac:name="title">Tab Title</ac:parameter>',
    "<p>Tab content.</p>",
  ]);
  if (s.includes("<tab")) {
    throw new Error("Expected <tab> tags to be removed in output");
  }
});

Deno.test("writerside: table header row converts td -> th", async () => {
  const md =
    "<table>" +
    "<tr><td>Header A</td><td>Header B</td></tr>" +
    "<tr><td>Row A</td><td>Row B</td></tr>" +
    "</table>";
  const t = new WritersideMarkdownTransformer(".");
  const s = await storageToString(t, md);
  expectIncludes(s, [
    "<table",
    "<th>Header A</th>",
    "<th>Header B</th>",
    "<td>Row A</td>",
    "<td>Row B</td>",
  ]);
});

Deno.test("writerside: note/tip/warning become Confluence macros", async () => {
  const md =
    "<note><p>Note text.</p></note>" +
    "<tip><p>Tip text.</p></tip>" +
    "<warning><p>Warning text.</p></warning>";
  const t = new WritersideMarkdownTransformer(".");
  const s = await storageToString(t, md);
  expectIncludes(s, [
    'ac:name="info"',
    'ac:name="tip"',
    'ac:name="warning"',
    "<p>Note text.</p>",
    "<p>Tip text.</p>",
    "<p>Warning text.</p>",
  ]);
});

Deno.test("writerside: emphasis tag becomes em", async () => {
  const md =
    "<p>Text with <emphasis>emphasis</emphasis>, <code>inline.code</code>.</p>";
  const t = new WritersideMarkdownTransformer(".");
  const s = await storageToString(t, md);
  expectIncludes(s, [
    "<em>emphasis</em>",
    "<code>inline.code</code>",
  ]);
  if (s.includes("<emphasis")) {
    throw new Error("Expected <emphasis> tag to be rewritten to <em>");
  }
});
Deno.test("writerside: summaries are removed/unwrapped", async () => {
  const md = `<link-summary>Short link summary.</link-summary>
<card-summary>Short card summary.</card-summary>
<tldr>
  <p>Scope: short highlight.</p>
  <p>Audience: short highlight.</p>
</tldr>`;
  const t = new WritersideMarkdownTransformer(".");
  const s = await storageToString(t, md);
  expectIncludes(s, [
    "<p>Scope: short highlight.</p>",
    "<p>Audience: short highlight.</p>",
  ]);
  if (s.includes("<link-summary") || s.includes("<card-summary") || s.includes("<tldr")) {
    throw new Error("Expected summary wrapper tags to be removed");
  }
});

Deno.test("writerside: deflist becomes Term/Definition table", async () => {
  const md = `<deflist>
  <def title="Term">
    <p>Definition text.</p>
  </def>
</deflist>`;
  const t = new WritersideMarkdownTransformer(".");
  const s = await storageToString(t, md);
  expectIncludes(s, [
    "<table",
    "<th><p>Term</p></th>",
    "<th><p>Definition</p></th>",
    "<p>Definition text.</p>",
  ]);
});
Deno.test("writerside: nested chapters get correct heading levels", async () => {
  const md = `<chapter title="Outer Chapter" id="outer">
  <p>Outer content.</p>
  <chapter title="Inner Chapter" id="inner">
    <p>Inner content.</p>
    <chapter title="Deeply Nested" id="deep">
      <p>Deep content.</p>
    </chapter>
  </chapter>
</chapter>`;
  const t = new WritersideMarkdownTransformer(".");
  const s = await storageToString(t, md);
  
  // Verify heading hierarchy: h3 -> h4 -> h5
  if (!s.includes('<h3 id="outer">Outer Chapter</h3>')) {
    throw new Error("Expected outer chapter to be h3");
  }
  if (!s.includes('<h4 id="inner">Inner Chapter</h4>')) {
    throw new Error("Expected inner chapter to be h4");
  }
  if (!s.includes('<h5 id="deep">Deeply Nested</h5>')) {
    throw new Error("Expected deeply nested chapter to be h5");
  }
  if (s.includes("<chapter")) {
    throw new Error("Expected <chapter> tags to be removed");
  }
});
