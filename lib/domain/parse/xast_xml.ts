// xast_xml.ts
// XML→xast utilities (parse, root, attrs, children)
import { fromXml } from "xast-util-from-xml";
import type { Root, Element as XEl } from "xast";

// Remove XML declaration and any DOCTYPE (external or internal subset) todo
const XML_DECL_RE = /^\uFEFF?\s*<\?xml[\s\S]*?\?>\s*/i;
const DOCTYPE_RE  = /<!DOCTYPE[\s\S]*?>/i;

// Helpful for common gotchas: lone '&' in URLs, invalid named entities like &nbsp;
function preSanitize(xml: string): string {
  let s = xml.replace(XML_DECL_RE, "").replace(DOCTYPE_RE, "");
  // Optional: fail fast on common HTML entities that are invalid in XML without a DTD
  // (If needed, map them to numeric refs first.)
  if (/[&](nbsp|copy|hellip|mdash|ndash|laquo|raquo);/i.test(s)) {
    throw new Error(
      "[authord] XML contains HTML named entities (e.g. &nbsp;). " +
      "XML only allows &lt; &gt; &amp; &apos; &quot; unless a DTD defines more. " +
      "Replace them with numeric refs (e.g. &#160;)."
    );
  }
  return s;
}

export function parseXmlToXast(xml: string): Root {
  const sanitized = preSanitize(xml);
  try {
    return fromXml(sanitized);
  } catch (err: unknown) {
    const msg = (err as { message?: string })?.message ?? String(err);
    // Try to pull line/column info out of parse-xml’s message
    const m = msg.match(/line\s+(\d+),\s*column\s+(\d+)/i);
    const where = m ? ` (at line ${m[1]}, column ${m[2]})` : "";
    console.log(`[authord] XML parse error${where}: ${msg}`);
    throw new Error(`[authord] XML parse error${where}: ${msg}`);
  }
}

export function getRootElement(ast: Root): XEl {
  const el = ast.children.find((n) => n.type === "element") as XEl | undefined;
  if (!el) throw new Error("XML has no root element");
  return el;
}

export function localName(qname: string): string {
  const i = qname.indexOf(":");
  return i >= 0 ? qname.slice(i + 1) : qname;
}

export function getAttr(el: XEl, name: string): string | undefined {
  return (el.attributes?.[name] as string | undefined) ?? undefined;
}

export function childElements(el: XEl, name?: string): XEl[] {
  return (el.children.filter((c) => c.type === "element") as XEl[])
    .filter((c) => (name ? localName(c.name) === name : true));
}

export function firstChild(el: XEl, name: string): XEl | undefined {
  return childElements(el, name)[0];
}
