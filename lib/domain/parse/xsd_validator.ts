// xsd_validator.ts
// Validate xast AST against XSD index
import type { Element as XEl } from "xast";
import { localName } from "./xast_xml.ts";
import type { XsdIndex } from "./xsd_index.ts";

const IGNORED_ATTR_PREFIXES = ["xmlns", "xml:", "xsi:"];

export function validateAgainstXsd(root: XEl, expectedRoot: string, xsd: XsdIndex): void {
  const errors: { path: string; msg: string }[] = [];
  walk(root, "", expectedRoot, xsd, errors);

  // todo
  if (errors.length) {
    const msg = errors.map((e) => `- ${e.path}: ${e.msg}`).join("\n");
    console.error(`XSD validation failed:\n${msg}`);
    // throw new Error(`XSD validation failed:\n${msg}`);
  }
}

function walk(el: XEl, path: string, expectedRoot: string, xsd: XsdIndex, errors: { path: string; msg: string }[]) {
  const name = localName(el.name);
  const here = path ? `${path}/${name}` : `/${name}`;

  if (!path && name !== expectedRoot) {
    errors.push({ path: here, msg: `Root must be <${expectedRoot}>` });
  }

  const def = xsd.elements.get(name);
  if (!def) {
    errors.push({ path: here, msg: `Element <${name}> is not declared` });
  }

  const attrs = Object.keys(el.attributes ?? {});
  if (def) {
    for (const a of attrs) {
      if (IGNORED_ATTR_PREFIXES.some((p) => a.startsWith(p))) continue;
      const bare = localName(a);
      if (!def.attributes.has(bare) && !xsd.attributes.has(bare)) {
        errors.push({ path: here, msg: `Unknown attribute "${a}" on <${name}>` });
      }
    }
    for (const [a, use] of def.attributes.entries()) {
      if (use === "required" && !attrs.includes(a)) {
        errors.push({ path: here, msg: `Missing required attribute "${a}" on <${name}>` });
      }
    }
  }

  const kids = (el.children.filter((c: { type: string; }) => c.type === "element") as XEl[]);
  if (def) {
    for (const k of kids) {
      const kn = localName(k.name);
      if (!def.allowedChildren.has(kn)) {
        errors.push({ path: `${here}/${kn}`, msg: `Child <${kn}> not allowed under <${name}>` });
      }
    }
  }
  for (const k of kids) walk(k, here, expectedRoot, xsd, errors);
}
