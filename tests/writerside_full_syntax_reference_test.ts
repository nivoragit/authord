import { WritersideMarkdownTransformer } from "@authord/render-core/writerside_markdown_transformer.ts";

const SYNTAX_REFERENCE_MD = String.raw`# Syntax Reference

Collected syntax patterns from the Markdown files in this folder.

## Page Entry

[//]: # (<section-starting-page>)

[//]: # (  <title>Guide Title</title>)

[//]: # (  <description>Short page description.</description>)

[//]: # (  <spotlight>)

[//]: # (    <card href="some-page.md" title="Spotlight item"/>)

[//]: # (  </spotlight>)

[//]: # (  <primary>)

[//]: # (    <title>Primary section</title>)

[//]: # (    <card href="primary.md" title="Primary item"/>)

[//]: # (  </primary>)

[//]: # (  <secondary>)

[//]: # (    <title>Secondary section</title>)

[//]: # (    <card href="secondary.md" title="Secondary item"/>)

[//]: # (  </secondary>)

[//]: # (</section-starting-page>)


## Summaries
<link-summary>Short link summary.</link-summary>
<card-summary>Short card summary.</card-summary>
<tldr>
  <p>Scope: short highlight.</p>
  <p>Audience: short highlight.</p>
</tldr>

## Structure
<show-structure for="chapter" depth="2"/>
<chapter title="Chapter Title" id="chapter-id">
  <p>Paragraph text.</p>
  <chapter title="Nested Chapter" id="nested-chapter-id">
    <p>Nested paragraph text.</p>
  </chapter>
</chapter>

## Inline Elements
<p>Text with <emphasis>emphasis</emphasis>, <code>inline.code</code>, and <a href="some-page.md">a link</a>.</p>

## Lists
<list type="bullet">
  <li><p>Bullet item</p></li>
  <li><p>Another bullet</p></li>
</list>

<list type="decimal">
  <li><p>Numbered item</p></li>
  <li><p>Another numbered item</p></li>
</list>

<list>
  <li><p>Default list item</p></li>
</list>

## Definitions
<deflist>
  <def title="Term">
    <p>Definition text.</p>
  </def>
</deflist>

## Procedures
<procedure title="Procedure Title" id="procedure-id">
  <step>
    <p>Do the thing.</p>
    <code-block lang="bash">
echo "example"
    </code-block>
  </step>
</procedure>

<procedure title="Procedure Title Only">
  <step>
    <p>Step without id.</p>
  </step>
</procedure>

<procedure>
  <step>
    <p>Step without title.</p>
  </step>
</procedure>

## Cards and Comparisons

<cards>
<title>"Card Title"</title>
 <p> Card body. </p>
</cards>

<card href="linked-page.md" title="Linked Card"/>

<compare first-title="First Column" second-title="Second Column">
    <code-block lang="bash">
    echo "first"
    </code-block>
    <code-block lang="bash">
    echo "second"
    </code-block>
</compare>

## Tabs
<tabs>
  <tab title="Tab Title">
    <p>Tab content.</p>
  </tab>
</tabs>

## Tables
<table>
  <tr>
    <td>Header A</td>
    <td>Header B</td>
  </tr>
  <tr>
    <td>Row A</td>
    <td>Row B</td>
  </tr>
</table>

## Admonitions
<note>
  <p>Note text.</p>
</note>
<tip>
  <p>Tip text.</p>
</tip>
<warning>
  <p>Warning text.</p>
</warning>

## Code Blocks
<code-block lang="bash">
echo "bash"
</code-block>

<code-block lang="http">
GET /example HTTP/1.1
Host: api.example.com
</code-block>

<code-block lang="java">
class Example {}
</code-block>

<code-block lang="json">
{"key":"value"}
</code-block>

<code-block lang="promql">
up
</code-block>

<code-block lang="sql">
SELECT 1;
</code-block>

<code-block lang="text">
Plain text
</code-block>

<code-block lang="yaml">
key: value
</code-block>

## Includes
<include from="glossary-lib.md"/>
`;

function expectIncludes(haystack: string, needles: string[], ctx = "output") {
  for (const n of needles) {
    if (!haystack.includes(n)) {
      throw new Error(`Expected ${ctx} to include:\n${n}\n\nGot:\n${haystack}`);
    }
  }
}

Deno.test("writerside: full syntax reference renders key constructs", async () => {
  const transformer = new WritersideMarkdownTransformer(".");
  const result = String(await transformer.toStorage(SYNTAX_REFERENCE_MD));

  expectIncludes(result, [
    "<h1>Syntax Reference</h1>",
    'ac:name="toc"',
    "<h2>Summaries</h2>",
    "Scope: short highlight.",
    "<h2>Structure</h2>",
    '<h3 id="chapter-id">Chapter Title</h3>',
    '<h4 id="nested-chapter-id">Nested Chapter</h4>',
    "<h2>Definitions</h2>",
    "<th><p>Term</p></th>",
    "<h2>Cards and Comparisons</h2>",
    'ac:name="section"',
    'ac:name="expand"',
    "<h2>Admonitions</h2>",
    'ac:name="warning"',
    "<h2>Code Blocks</h2>",
    'ac:name="code"',
  ]);

  if (result.includes("<chapter")) {
    throw new Error("Expected <chapter> tags to be flattened");
  }
  if (result.includes("<link-summary") || result.includes("<card-summary") || result.includes("<tldr")) {
    throw new Error("Expected summary wrapper tags to be removed");
  }
});
