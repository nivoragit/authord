// parsers_test.ts
import { assertEquals, assertRejects } from "std/assert";
import { WritersideCfgParser } from "@authord/render-core/core/domain/parse/cfg_parser.ts";
import { InstanceProfileParser } from "@authord/render-core/core/domain/parse/instance_profile_parser.ts";
import { TopicParser } from "@authord/render-core/core/domain/parse/topic_parser.ts";


// ---- sample CFG XML ----
const CFG_XML = `<ihp xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:noNamespaceSchemaLocation="https://resources.jetbrains.com/writerside/1.0/writerside-cfg.xsd">
  <topics dir="topics" />
  <images dir="images" web-path="images" />
  <snippets src="snippets" />
  <instance src="laravel-lang.tree" web-path="/" />
  <instance src="docs_libraries.tree" />
</ihp>`;

// Minimal XSD subset for CFG
const CFG_XSD = `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="ihp">
    <xs:complexType>
      <xs:sequence>
        <xs:element ref="topics" minOccurs="0" maxOccurs="1"/>
        <xs:element ref="images" minOccurs="0" maxOccurs="1"/>
        <xs:element ref="snippets" minOccurs="0" maxOccurs="1"/>
        <xs:element ref="instance" minOccurs="0" maxOccurs="unbounded"/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
  <xs:element name="topics">
    <xs:complexType><xs:attribute name="dir" type="xs:string"/></xs:complexType>
  </xs:element>
  <xs:element name="images">
    <xs:complexType>
      <xs:attribute name="dir" type="xs:string"/>
      <xs:attribute name="web-path" type="xs:string"/>
    </xs:complexType>
  </xs:element>
  <xs:element name="snippets">
    <xs:complexType><xs:attribute name="src" type="xs:string"/></xs:complexType>
  </xs:element>
  <xs:element name="instance">
    <xs:complexType>
      <xs:attribute name="src" type="xs:string" use="required"/>
      <xs:attribute name="web-path" type="xs:string"/>
    </xs:complexType>
  </xs:element>
</xs:schema>`;

// ---- sample Instance-Profile XML & DTD ----
const INSTANCE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE instance-profile SYSTEM "https://resources.jetbrains.com/writerside/1.0/product-profile.dtd">
<instance-profile id="docs_libraries" name="docs_libraries" is-library="true" start-page="library-starting-page.topic">
  <toc-element topic="library-starting-page.topic"/>
  <toc-element topic="library-our-team.topic"/>
  <toc-element topic="library-needs.topic"/>
</instance-profile>`;

// (provided DTD from your prompt)
const INSTANCE_DTD = `<!ELEMENT instance-profile (toc-element|include|snippet)*>
<!ELEMENT toc-element  (toc-element|include|snippet)*>
<!ELEMENT snippet  (toc-element|include|snippet)*>
<!ELEMENT include EMPTY>
<!ATTLIST instance-profile
        id CDATA #REQUIRED
        name CDATA #REQUIRED
        start-page CDATA #REQUIRED
        is-library (true|false) "false"
        status (release|eap|deprecated) "release">
<!ATTLIST toc-element
        id ID #IMPLIED
        topic CDATA #IMPLIED
        hidden CDATA #IMPLIED
        toc-title CDATA #IMPLIED
        origin CDATA #IMPLIED
        filter CDATA #IMPLIED
        href CDATA #IMPLIED
        accepts-web-file-names-ref CDATA #IMPLIED
        accepts-web-file-names CDATA #IMPLIED
        sort-children (ascending|descending|none) "none"
        instance CDATA #IMPLIED
        ref CDATA #IMPLIED
        in CDATA #IMPLIED
        target-for-accept-web-file-names CDATA #IMPLIED>
<!ATTLIST snippet
        id ID #IMPLIED
        filter CDATA #IMPLIED
        instance CDATA #IMPLIED>
<!ATTLIST include
        from CDATA #REQUIRED
        element-id CDATA #REQUIRED
        origin CDATA #IMPLIED
        use-filter CDATA #IMPLIED
        instance CDATA #IMPLIED>`;

// ---- sample Topic XML (trimmed from your prompt) & minimal XSD subset ----
const TOPIC_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE topic SYSTEM "https://resources.jetbrains.com/writerside/1.0/xhtml-entities.dtd">
<topic xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:noNamespaceSchemaLocation="https://resources.jetbrains.com/writerside/1.0/topic.v2.xsd"
  title="Configuration" id="configuration">
  <link-summary>Summary</link-summary>
  <card-summary>Summary</card-summary>
  <web-summary>Summary</web-summary>
  <show-structure depth="2"/>
  <chapter title="Publish" id="publish">
    <p>Text</p>
    <code-block lang="bash">echo ok</code-block>
    <include from="library-descriptions.topic" element-id="available-config-option"/>
  </chapter>
</topic>`;

const TOPIC_XSD = `
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:attribute name="id" type="xs:string"/>
  <xs:attribute name="element-id" type="xs:string"/>
  <xs:element name="topic">
    <xs:complexType>
      <xs:sequence>
        <xs:element ref="link-summary" minOccurs="0"/>
        <xs:element ref="card-summary" minOccurs="0"/>
        <xs:element ref="web-summary" minOccurs="0"/>
        <xs:element ref="show-structure" minOccurs="0" maxOccurs="unbounded"/>
        <xs:element ref="chapter" minOccurs="0" maxOccurs="unbounded"/>
      </xs:sequence>
      <xs:attribute ref="id"/>
      <xs:attribute name="title" type="xs:string"/>
    </xs:complexType>
  </xs:element>
  <xs:element name="link-summary"><xs:complexType mixed="true"/></xs:element>
  <xs:element name="card-summary"><xs:complexType mixed="true"/></xs:element>
  <xs:element name="web-summary"><xs:complexType mixed="true"/></xs:element>
  <xs:element name="show-structure"><xs:complexType>
    <xs:attribute name="depth" type="xs:string"/></xs:complexType></xs:element>
  <xs:element name="chapter"><xs:complexType mixed="true">
    <xs:sequence minOccurs="0" maxOccurs="unbounded">
      <xs:choice minOccurs="0" maxOccurs="unbounded">
        <xs:element ref="p" minOccurs="0" maxOccurs="unbounded"/>
        <xs:element ref="code-block" minOccurs="0" maxOccurs="unbounded"/>
        <xs:element ref="include" minOccurs="0" maxOccurs="unbounded"/>
      </xs:choice>
    </xs:sequence>
    <xs:attribute name="title" type="xs:string"/>
    <xs:attribute ref="id"/>
  </xs:complexType></xs:element>
  <xs:element name="p"><xs:complexType mixed="true"/></xs:element>
  <xs:element name="code-block"><xs:complexType mixed="true">
    <xs:attribute name="lang" type="xs:string"/>
  </xs:complexType></xs:element>
  <xs:element name="include"><xs:complexType>
    <xs:attribute name="from" type="xs:string" use="required"/>
    <xs:attribute ref="element-id" use="required"/>
  </xs:complexType></xs:element>
</xs:schema>`;

// ---- fetch stub that returns the right schema based on URL ----
function withSchemaFetch<T>(fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = (input: RequestInfo | URL) => {
    const url = String(input);
    let body = "";
    if (url.endsWith("writerside-cfg.xsd")) body = CFG_XSD;
    else if (url.endsWith("topic.v2.xsd")) body = TOPIC_XSD;
    else if (url.endsWith("product-profile.dtd")) body = INSTANCE_DTD;
    else body = "";
    return Promise.resolve(new Response(body, { status: 200 }));
  };
  return fn().finally(() => (globalThis.fetch = real));
}

// ---- tests ----
Deno.test("cfg parser → IRConfig (happy path)", async () => {
  await withSchemaFetch(async () => {
    const cfg = await new WritersideCfgParser().parse(CFG_XML);
    assertEquals(cfg.topicsDir, "topics");
    assertEquals(cfg.snippetsDir, "snippets");
    assertEquals(cfg.imagesDir, { dir: "images", webPath: "images" });
    assertEquals(cfg.instances.length, 2);
    assertEquals(cfg.instances[0], { src: "laravel-lang.tree", webPath: "/" });
  });
});

Deno.test("instance-profile parser → AST (happy path)", async () => {
  await withSchemaFetch(async () => {
    const ast = await new InstanceProfileParser().parse(INSTANCE_XML);
    assertEquals(ast.name, "instance-profile");
  });
});

Deno.test("instance-profile parser rejects unknown child", async () => {
  const bad = INSTANCE_XML.replace("</instance-profile>", "  <unknown/>\n</instance-profile>");
  await withSchemaFetch(async () => {
    await assertRejects(() => new InstanceProfileParser().parse(bad));
  });
});

Deno.test("topic parser → AST (happy path)", async () => {
  await withSchemaFetch(async () => {
    const ast = await new TopicParser().parse(TOPIC_XML);
    assertEquals(ast.name, "topic");
  });
});

Deno.test("topic parser rejects unknown child under <topic>", async () => {
  const bad = TOPIC_XML.replace("</topic>", "  <surprise/>\n</topic>");
  await withSchemaFetch(async () => {
    await assertRejects(() => new TopicParser().parse(bad));
  });
});
