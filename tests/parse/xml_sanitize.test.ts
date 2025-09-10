import { assert, assertThrows } from "std/assert";
import { parseXmlToXast, preSanitize } from "../../lib/domain/parse/xast_xml.ts";

/** A trimmed but representative chunk of your sanitized XSD content */
const XSD_SNIPPET = `<!--suppress XmlDefaultAttributeValue -->
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" version="1.0">
  <xs:element name="module">
    <xs:annotation><xs:documentation>
      <p>Specify settings for the help module.</p>
    </xs:documentation></xs:annotation>
    <xs:complexType><xs:simpleContent><xs:extension base="xs:string">
      <xs:attribute type="xs:string" name="name">
        <xs:annotation><xs:documentation>
          <p>Specify the name of the help module.</p>
        </xs:documentation></xs:annotation>
      </xs:attribute>
    </xs:extension></xs:simpleContent></xs:complexType>
  </xs:element>

  <xs:element name="default-property">
    <xs:annotation><xs:documentation>
      <p>Example with code.</p>
      <pre>
&lt;default-property element-name="img" property-name="border-effect" value="line"/&gt;
      </pre>
      &lt;p&gt;Specify which elements the attribute will be applied to.</p>
    </xs:documentation></xs:annotation>
    <xs:complexType><xs:simpleContent><xs:extension base="xs:string">
      <xs:attribute type="xs:string" name="element-name"/>
    </xs:extension></xs:simpleContent></xs:complexType>
  </xs:element>

  <xs:element name="caps">
    <xs:annotation><xs:documentation>
      <p>Titles</p>
      <ul><li>One</li><li>Two</li></ul>
      5 < 7 &copy; &unknown;
    </xs:documentation></xs:annotation>
    <xs:complexType><xs:simpleContent><xs:extension base="xs:string"/></xs:complexType>
  </xs:element>
</xs:schema>
`;

Deno.test("preSanitize: repairs stray closing tags in documentation", () => {
  const out = preSanitize(XSD_SNIPPET, {
    // default richTextContainers already includes "documentation"
  });
  // `&lt;p&gt;` remained literal; the stray `</p>` must be neutralized to `&lt;/p&gt;`
  assert(out.includes("&lt;p&gt;Specify which elements"));
  assert(out.includes("&lt;/p&gt;")); // closing tag neutralized
});

Deno.test("preSanitize: preserves allowed HTML inside <xs:documentation>", () => {
  const out = preSanitize(XSD_SNIPPET);
  // <p>, <ul>, <li>, <pre> should survive as real XML elements
  assert(out.includes("<p>Titles</p>"));
  assert(out.includes("<ul>"));
  assert(out.includes("<li>One</li>"));
  assert(out.includes("<pre>"));
});

Deno.test("preSanitize: escapes bare math angles safely", () => {
  const out = preSanitize(XSD_SNIPPET);
  assert(out.includes("5 &lt; 7")); // bare '<' turned into &lt;
});

Deno.test("preSanitize: normalizes named entities and unknowns", () => {
  const out = preSanitize(XSD_SNIPPET, {
    entityPolicy: "convert",
  });
  // &copy; becomes numeric
  assert(out.includes("&#169;"));
  // &unknown; → &amp;unknown; (escaped ampersand)
  assert(out.includes("&amp;unknown;"));
});

Deno.test("preSanitize: masks CDATA / PIs / comments and repairs comment body", () => {
  const sample = `
<?xml version="1.0"?>
<!DOCTYPE example [ <!ENTITY x "y"> ]>
<root>
  <![CDATA[A <tag> & stuff]]>
  <?pi data?>
  <!-- bad -- comment with -- double dash -->
  <xs:annotation><xs:documentation>inside</xs:documentation></xs:annotation>
</root>
`;
  const out = preSanitize(sample);
  // Prolog & DOCTYPE stripped
  if (out.includes("<?xml") || out.includes("<!DOCTYPE")) {
    throw new Error("Prolog/DOCTYPE not stripped");
  }
  // Comment body repaired
  if (!out.includes("<!-- bad - - comment with - - double dash -->")) {
    throw new Error("Comment body not repaired");
  }
  // CDATA & PI preserved verbatim (masked & restored unchanged)
  assert(out.includes("<![CDATA[A <tag> & stuff]]>"));
  assert(out.includes("<?pi data?>"));
});

// Deno.test("parseXmlToXast: whole XSD parses without @rgrove/parse-xml errors", () => {
//   const ast = parseXmlToXast(XSD_SNIPPET);
//   assert(!!ast && Array.isArray(ast.children));
// });

Deno.test("entityPolicy=error throws on unknown named entity", () => {
  const sample = `<r><xs:annotation><xs:documentation>&unknown;</xs:documentation></xs:annotation></r>`;
  assertThrows(
    () => preSanitize(sample, { entityPolicy: "error" }),
    Error,
    "Unknown named entity",
  );
});

// Deno.test("forceTextInContainers neutralizes all tags inside documentation", () => {
//   const sample = `<r><xs:annotation><xs:documentation><p>x</p><ac:image/></xs:documentation></xs:annotation></r>`;
//   const out = preSanitize(sample, { forceTextInContainers: true });
//   // inner tags neutralized
//   assert(out.includes("&lt;p&gt;x&lt;/p&gt;"));
//   assert(out.includes("&lt;ac:image/&gt;"));
//   // but the container closers remain real tags
//   assert(out.includes("</xs:documentation>"));
// });
