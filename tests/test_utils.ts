// test_utils.ts
export async function withSchemaFetch(
  schemas: Record<string, string>,
  fn: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: Request | string | URL) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
        ? input.href
        : input.url;

    if (!(url in schemas)) {
      return new Response(`No stub schema for ${url}`, { status: 404 });
    }
    return new Response(schemas[url], {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }) as typeof fetch;

  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
}

// ---------------------- Schema URLs ----------------------

export const INSTANCE_DTD_URL = "https://example.test/instance-profile.dtd";
export const CFG_XSD_URL = "https://example.test/writerside-cfg.xsd";
export const TOPIC_XSD_URL = "https://example.test/topic.xsd";

// ---------------------- DTD (strict cases) ----------------------

export const INSTANCE_DTD = `<!ELEMENT instance-profile (empty-el, any-el, pcdata-only, mixed, elem-only, choices, repeating+)>
<!ATTLIST instance-profile version CDATA #REQUIRED>

<!ELEMENT empty-el EMPTY>
<!ATTLIST empty-el requiredAttr CDATA #REQUIRED>

<!ELEMENT any-el ANY>

<!ELEMENT pcdata-only (#PCDATA)>

<!ELEMENT mixed (#PCDATA|b|i)*>
<!ATTLIST mixed mode (a|b) #REQUIRED fixed CDATA #FIXED "yes">

<!ELEMENT b (#PCDATA)>
<!ELEMENT i (#PCDATA)>

<!ELEMENT elem-only (b, i?)>

<!ELEMENT choices (a|bchild)>
<!ELEMENT a EMPTY>
<!ELEMENT bchild EMPTY>

<!ELEMENT repeating (a)>
`;

// A valid instance-profile that exercises: EMPTY, ANY, (#PCDATA), mixed, seq/?, choice, +
export const INSTANCE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE instance-profile SYSTEM "${INSTANCE_DTD_URL}">
<instance-profile version="1.0">
  <empty-el requiredAttr="x"/>
  <any-el><b>ok</b>text</any-el>
  <pcdata-only>hello</pcdata-only>
  <mixed mode="a" fixed="yes">hi <b>bold</b><i>it</i></mixed>
  <elem-only><b>t</b><i>u</i></elem-only>
  <choices><a/></choices>
  <repeating><a/></repeating>
  <repeating><a/></repeating>
</instance-profile>
`;

// ---------------------- XSD (strict cases) ----------------------
// Covers: complexContent/extension, groupRef, attributeGroup, enums, fixed, xs:anyAttribute, xs:any, xs:all, order/minOccurs.

export const CFG_XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">

  <xs:attributeGroup name="commonId">
    <xs:attribute name="id" use="required"/>
  </xs:attributeGroup>

  <xs:complexType name="TopicsType">
    <xs:attribute name="dir" use="required"/>
  </xs:complexType>
  <xs:element name="topics" type="TopicsType"/>

  <xs:complexType name="ImagesType">
    <xs:attribute name="dir" use="optional"/>
    <xs:attribute name="web-path" use="optional"/>
  </xs:complexType>
  <xs:element name="images" type="ImagesType"/>

  <xs:element name="build-config">
    <xs:complexType/>
  </xs:element>

  <xs:element name="caps">
    <xs:complexType>
      <xs:attribute name="for" use="required"/>
      <xs:attribute name="style">
        <xs:simpleType>
          <xs:restriction base="xs:string">
            <xs:enumeration value="sentence"/>
            <xs:enumeration value="title"/>
            <xs:enumeration value="aswritten"/>
          </xs:restriction>
        </xs:simpleType>
      </xs:attribute>
    </xs:complexType>
  </xs:element>

  <xs:element name="settings">
    <xs:complexType>
      <xs:all>
        <xs:element ref="caps" minOccurs="1" maxOccurs="1"/>
        <xs:element ref="build-config" minOccurs="0" maxOccurs="1"/>
      </xs:all>
    </xs:complexType>
  </xs:element>

  <xs:element name="extension">
    <xs:complexType/>
  </xs:element>

  <xs:element name="resources">
    <xs:complexType>
      <xs:sequence>
        <xs:any minOccurs="0" maxOccurs="unbounded"/>
      </xs:sequence>
      <xs:anyAttribute/>
    </xs:complexType>
  </xs:element>

  <xs:complexType name="InstanceType">
    <xs:attributeGroup ref="commonId"/>
    <xs:attribute name="src" use="required"/>
    <xs:attribute name="keymaps-mode">
      <xs:simpleType>
        <xs:restriction base="xs:string">
          <xs:enumeration value="generated"/>
          <xs:enumeration value="provided"/>
          <xs:enumeration value="none"/>
        </xs:restriction>
      </xs:simpleType>
    </xs:attribute>
    <xs:attribute name="fixed-flag" fixed="yes"/>
  </xs:complexType>
  <xs:element name="instance" type="InstanceType"/>

  <xs:group name="instancesGroup">
    <xs:sequence>
      <xs:element ref="instance" minOccurs="1" maxOccurs="2"/>
    </xs:sequence>
  </xs:group>

  <xs:complexType name="BaseIhpType">
    <xs:sequence>
      <xs:element ref="settings" minOccurs="0" maxOccurs="1"/>
      <xs:element ref="topics" minOccurs="1" maxOccurs="1"/>
    </xs:sequence>
    <xs:attribute name="version" use="required"/>
  </xs:complexType>

  <xs:complexType name="IhpType">
    <xs:complexContent>
      <xs:extension base="BaseIhpType">
        <xs:sequence>
          <xs:element ref="images" minOccurs="0" maxOccurs="1"/>
          <xs:element ref="resources" minOccurs="0" maxOccurs="1"/>
          <xs:group ref="instancesGroup"/>
        </xs:sequence>
        <xs:attribute name="mode">
          <xs:simpleType>
            <xs:restriction base="xs:string">
              <xs:enumeration value="dev"/>
              <xs:enumeration value="prod"/>
            </xs:restriction>
          </xs:simpleType>
        </xs:attribute>
      </xs:extension>
    </xs:complexContent>
  </xs:complexType>

  <xs:element name="ihp" type="IhpType"/>
</xs:schema>
`;

export const CFG_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ihp xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
     xsi:noNamespaceSchemaLocation="${CFG_XSD_URL}"
     version="2.0"
     mode="dev">
  <settings>
    <build-config/>
    <caps for="ui" style="aswritten"/>
  </settings>

  <topics dir="topics"/>

  <images dir="images" web-path="images"/>

  <resources extra="ok"><extension/></resources>

  <instance id="i1" src="as.tree" keymaps-mode="none" fixed-flag="yes"/>
</ihp>
`;

// ---------------------- Topic XSD + XML ----------------------

export const TOPIC_XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">

  <xs:element name="title">
    <xs:complexType mixed="true"/>
  </xs:element>

  <xs:complexType name="PType" mixed="true"/>
  <xs:element name="p" type="PType"/>

  <xs:complexType name="BodyType">
    <xs:sequence>
      <xs:element ref="p" minOccurs="1" maxOccurs="unbounded"/>
    </xs:sequence>
  </xs:complexType>
  <xs:element name="body" type="BodyType"/>

  <xs:complexType name="TopicType">
    <xs:sequence>
      <xs:element ref="title" minOccurs="1" maxOccurs="1"/>
      <xs:element ref="body" minOccurs="1" maxOccurs="1"/>
    </xs:sequence>
  </xs:complexType>

  <xs:element name="topic" type="TopicType"/>
</xs:schema>
`;

export const TOPIC_XML = `<?xml version="1.0" encoding="UTF-8"?>
<topic xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
       xsi:noNamespaceSchemaLocation="${TOPIC_XSD_URL}">
  <title>Hello</title>
  <body>
    <p>Text</p>
  </body>
</topic>
`;
