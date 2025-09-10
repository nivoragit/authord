// xast_xml.test.ts
import { assertEquals, assert } from "std/assert";
import { parseXmlToXast, preSanitize } from "../../lib/domain/parse/xast_xml.ts";

Deno.test("strips xml decl and doctype", () => {
  const src = `<?xml version="1.0"?><!DOCTYPE topic SYSTEM "x.dtd"><topic id="t"><p>ok</p></topic>`;
  const out = preSanitize(src);
  assert(!/^<\?xml/.test(out));
  assert(!/^<!DOCTYPE/.test(out));
});

Deno.test("replaces HTML named entities with numeric outside CDATA", () => {
  const src = `<topic id="t"><p>A&nbsp;B &copy; &hellip;</p><![CDATA[ keep &nbsp; &copy; <img> ]]></topic>`;
  const out = preSanitize(src);
  assert(out.includes("A&#160;B &#169; &#8230;"));
  assert(out.includes("<![CDATA[ keep &nbsp; &copy; <img> ]]>")); // untouched
});

Deno.test("escapes stray ampersands", () => {
  const src = `<topic id="t"><p>Tom & Jerry? a=1&b=2</p></topic>`;
  const out = preSanitize(src);
  assertEquals(out, `<topic id="t"><p>Tom &amp; Jerry? a=1&amp;b=2</p></topic>`);
});

Deno.test("escapes literal <code-block> mention inside <p>", () => {
  const src = `<topic id="t"><p>The following diagram uses <code-block lang="mermaid"> element.</p></topic>`;
  const out = preSanitize(src);
  assert(out.includes(`&lt;code-block lang="mermaid"&gt;`));
});

Deno.test("does not touch real <code-block> elements (outside <p>)", () => {
  const src = `<topic id="t"><chapter id="c"><code-block lang="mermaid">graph TD; A-->B;</code-block></chapter></topic>`;
  const out = preSanitize(src);
  assert(out.includes(`<code-block lang="mermaid">graph TD; A-->B;</code-block>`));
});

Deno.test("parses sanitized XML to xast", () => {
  const src = `
    <?xml version="1.0"?>
    <!DOCTYPE topic SYSTEM "x.dtd">
    <topic id="t">
      <p>Tom & Jerry &nbsp; ©</p>
      <chapter id="c">
        <code-block lang="mermaid">graph TD; A-->B;</code-block>
      </chapter>
      <![CDATA[ raw <img> should remain ]]>
    </topic>`;
  const ast = parseXmlToXast(src);
  assert(ast && Array.isArray(ast.children));
});

Deno.test("literalTagEscape: escapes both ends of <code-block> mention", () => {
  const src = `<topic id="t"><p>Use <code-block lang="mermaid"> element.</p></topic>`;
  const out = preSanitize(src);
  assertEquals(
    out,
    `<topic id="t"><p>Use &lt;code-block lang="mermaid"&gt; element.</p></topic>`,
  );
});

/* ───────────────────────── Fixtures ───────────────────────── */

const TOPIC_WRAP = (inner: string) => `<topic id="t">${inner}</topic>`;

/* ───────────────────────── Prolog ───────────────────────── */

Deno.test("strips xml decl and doctype", () => {
  const src = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE topic SYSTEM "https://example.com/whatever.dtd">
${TOPIC_WRAP("<p>ok</p>")}`;
  const out = preSanitize(src);
  assert(!out.startsWith("<?xml"));
  assert(!out.startsWith("<!DOCTYPE"));
  assert(out.includes("<topic"));
});

/* ───────────────────────── Entities & Ampersands ───────────────────────── */

Deno.test("converts common HTML named entities to numeric", () => {
  const src = TOPIC_WRAP(`<p>A&nbsp;B &copy; &hellip; &mdash;</p>`);
  const out = preSanitize(src);
  assert(out.includes("A&#160;B &#169; &#8230; &#8212;"));
  // must parse
  const ast = parseXmlToXast(src);
  assert(Array.isArray(ast.children));
});

Deno.test("unknown named entity policy: escape (default is convert→escape fallback)", () => {
  const src = TOPIC_WRAP(`<p>X &foo; Y</p>`);
  const out = preSanitize(src, { entityPolicy: "convert" });
  assertEquals(out, TOPIC_WRAP(`<p>X &amp;foo; Y</p>`));
});

Deno.test("unknown named entity policy: error", () => {
  const src = TOPIC_WRAP(`<p>X &foo; Y</p>`);
  let threw = false;
  try { preSanitize(src, { entityPolicy: "error" }); } catch { threw = true; }
  assert(threw);
});

Deno.test("passes through numeric entities and escapes stray &", () => {
  const src = TOPIC_WRAP(`<p>n=&123; hex=&#x1F; good=&#169; a=1&b=2 & hello</p>`);
  const out = preSanitize(src);
  // invalid "=&123;" becomes "&amp;#123;" due to "&" before not numeric; good numeric preserved; stray escaped
  assert(out.includes("hex=&#x1F;"));
  assert(out.includes("good=&#169;"));
  assert(out.includes("a=1&amp;b=2 &amp; hello"));
});

/* ───────────────────────── Protected Segments ───────────────────────── */

Deno.test("does not touch content inside CDATA/comments/PIs", () => {
  const src = TOPIC_WRAP(
    `<p>A &nbsp; B</p><![CDATA[ raw <img> &nbsp; ]]><!-- x &nbsp; --><p><?pi test?></p>`,
  );
  const out = preSanitize(src);
  // inside first <p>, &nbsp; converted; inside CDATA/comment/PI, left verbatim
  assert(out.includes(`<p>A &#160; B</p>`));
  assert(out.includes(`<![CDATA[ raw <img> &nbsp; ]]>`));
  assert(out.includes(`<!-- x &nbsp; -->`));
  assert(out.includes(`<?pi test?>`));
});

/* ───────────────────────── Comment repair & control chars ───────────────────────── */

Deno.test("repairs illegal comment bodies containing --", () => {
  const src = TOPIC_WRAP(`<!-- a--b --><p>ok</p>`);
  const out = preSanitize(src);
  assert(out.includes("<!-- a- -b -->")); // "--" -> "- -"
});

Deno.test("scrubs invalid XML 1.0 control chars", () => {
  const bad = String.fromCharCode(0x01) + "ok" + String.fromCharCode(0x0B);
  const src = TOPIC_WRAP(`<p>${bad}</p>`);
  const out = preSanitize(src);
  assertEquals(out, TOPIC_WRAP(`<p>ok</p>`));
});

/* ───────────────────────── Text container policies ───────────────────────── */

Deno.test("forceTextInContainers: allows arbitrary HTML-ish text in <p>", () => {
  const src = TOPIC_WRAP(`<p>< helo> 2 & 3 "this' is an </exapmple></p>`);
  const out = preSanitize(src, { forceTextInContainers: true });
  assertEquals(out, TOPIC_WRAP(`<p>&lt; helo> 2 &amp; 3 "this' is an &lt;/exapmple&gt;</p>`));
  const ast = parseXmlToXast(src, { forceTextInContainers: true });
  assert(Array.isArray(ast.children));
});

Deno.test("literalTagEscape: escapes <example> mention inside text containers", () => {
  const src = TOPIC_WRAP(
    `<p>The following diagram uses <example lang="mermaid"> element.</p>`,
  );
  const out = preSanitize(src);
  assert(out.includes(`&lt;example lang="mermaid"&gt; element.`));
});

Deno.test("does not escape real <code-block> elements outside text container", () => {
  const src = TOPIC_WRAP(
    `<chapter><code-block lang="mermaid">graph TD; A-->B;</code-block></chapter>`,
  );
  const out = preSanitize(src);
  assert(out.includes(`<code-block lang="mermaid">graph TD; A-->B;</code-block>`));
});

Deno.test("escapeBareAnglesInText: protects math-like '<' in <p>", () => {
  const src = TOPIC_WRAP(`<p>1 < 2 and 3 <x</p>`);
  const out = preSanitize(src, { escapeBareAnglesInText: true });
  assertEquals(out, TOPIC_WRAP(`<p>1 &lt; 2 and 3 &lt;x</p>`));
});

/* ───────────────────────── Parsing round-trip ───────────────────────── */

Deno.test("sanitized XML parses to xast", () => {
  const src = `<?xml version="1.0"?>
<!DOCTYPE topic SYSTEM "x.dtd">
${TOPIC_WRAP(`
  <p>Tom & Jerry &nbsp; ©</p>
  <chapter id="c">
    <code-block lang="mermaid">graph TD; A-->B;</code-block>
  </chapter>
  <![CDATA[ raw <img> should remain ]]>
`)}`;
  const ast = parseXmlToXast(src);
  assert(ast && Array.isArray(ast.children));
});

/* ───────────────────────── Idempotence ───────────────────────── */

Deno.test("sanitization is idempotent", () => {
  const src = TOPIC_WRAP(`<p>A &nbsp; B & foo; < helo> 1 < 2</p>`);
  const once = preSanitize(src, {
    forceTextInContainers: true,
    escapeBareAnglesInText: true,
  });
  const twice = preSanitize(once, {
    forceTextInContainers: true,
    escapeBareAnglesInText: true,
  });
  assertEquals(once, twice);
});

/* ───────────────────────── Configurable entities ───────────────────────── */

Deno.test("namedEntities map extends built-ins", () => {
  const src = TOPIC_WRAP(`<p>&mystar;</p>`);
  const out = preSanitize(src, { namedEntities: { mystar: 9733 } }); // ★
  assertEquals(out, TOPIC_WRAP(`<p>&#9733;</p>`));
});

Deno.test("escapes any literal <...> mention inside text containers", () => {
  const src = `<topic id="t"><p>hello <example lang="mermaid"> world <foo></p></topic>`;
  const out = preSanitize(src); // list not needed anymore
  assert(out.includes("&lt;example lang=\"mermaid\"&gt;"));
  assert(out.includes("&lt;foo&gt;"));
});


const TOPIC = (inner: string) => `<topic id="t">${inner}</topic>`;

/* ───────── Prolog ───────── */

Deno.test("strips xml decl and doctype", () => {
  const src = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE topic SYSTEM "https://example.com/whatever.dtd">
${TOPIC("<p>ok</p>")}`;
  const out = preSanitize(src);
  assert(!out.startsWith("<?xml"));
  assert(!out.startsWith("<!DOCTYPE"));
  assert(out.includes("<topic"));
});

/* ───────── Entities & Ampersands ───────── */

// Deno.test("converts common HTML named entities to numeric and keeps numeric", () => {
//   const src = TOPIC(`<p>A&nbsp;B &copy; hex=&#x1F; dec=&#169;</p>`);
//   const out = preSanitize(src);
//   assert(out.includes("A&#160;B &#169; hex=&#x1F; dec=&#169;"));
//   // round-trip parses
//   const ast = parseXmlToXast(src);
//   assert(Array.isArray(ast.children));
// });

Deno.test("unknown named entity policy convert→escape", () => {
  const src = TOPIC(`<p>X &foo; Y</p>`);
  const out = preSanitize(src, { entityPolicy: "convert" });
  assertEquals(out, TOPIC(`<p>X &amp;foo; Y</p>`));
});

/* ───────── Comments & control chars ───────── */

Deno.test("repairs illegal comment bodies", () => {
  const src = TOPIC(`<!-- a--b --><p>ok</p>`);
  const out = preSanitize(src);
  assert(out.includes("<!-- a- -b -->"));
});

Deno.test("scrubs invalid XML 1.0 control chars", () => {
  const bad = String.fromCharCode(0x01) + "ok" + String.fromCharCode(0x0B);
  const src = TOPIC(`<p>${bad}</p>`);
  const out = preSanitize(src);
  assertEquals(out, TOPIC(`<p>ok</p>`));
});

/* ───────── Text containers: catch literal <example> without breaking real tags ───────── */

Deno.test("escapes literal <example> mention inside <p>, preserves <code>", () => {
  const src = TOPIC(`<p>Use <example> and <code>x</code>.</p>`);
  const out = preSanitize(src, {
    // defaults already: escapeUnknownTagMentionsInText: true, escapeBareAnglesInText: true
  });
  assert(out.includes("&lt;example&gt;"));
  assert(out.includes("<code>x</code>")); // preserved
  const ast = parseXmlToXast(out);
  assert(Array.isArray(ast.children));
});

Deno.test("math-safe: escapes bare '<' not a tag and incomplete '<x'", () => {
  const src = TOPIC(`<p>1 < 2 and <x</p>`);
  const out = preSanitize(src); // escapeBareAnglesInText default true
  assertEquals(out, TOPIC(`<p>1 &lt; 2 and &lt;x</p>`));
});

/* ───────── XSD-like documentation stays well-formed ───────── */

Deno.test("XSD documentation: keeps real tags like <pre> and escapes only literal mentions", () => {
  const src = `<!--suppress XmlDefaultAttributeValue -->
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" version="1.0">
  <xs:element name="settings">
    <xs:annotation>
      <xs:documentation>
        <p>
          Specify whether web file names should be normalized. For example,
          <code>My___Awesome.topic</code> becomes <code>my-awesome.html</code>.
        </p>
        <p>Literal example tag mention: <example attr="x"></example></p>
        <pre>
          &lt;default-property element-name="img" value="line"/&gt;
        </pre>
      </xs:documentation>
    </xs:annotation>
  </xs:element>
</xs:schema>`;
  const out = preSanitize(src);
  // real <pre> must remain real, not &lt;/pre&gt;
  assert(out.includes("<pre>"));
  assert(out.includes("</pre>"));
  // literal <example> should be escaped inside <p>
  assert(out.includes("&lt;example attr=\"x\"&gt;&lt;/example&gt;"));
  // parses
  const ast = parseXmlToXast(out);
  assert(Array.isArray(ast.children));
});

/* ───────── Idempotence ───────── */

Deno.test("sanitization is idempotent", () => {
  const src = TOPIC(`<p>A &nbsp; B 1 < 2 and <example/></p>`);
  const once = preSanitize(src);
  const twice = preSanitize(once);
  assertEquals(once, twice);
});


