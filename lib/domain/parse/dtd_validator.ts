// dtd_validator.ts
// Validate xast AST against DTD index
import type { Element as XEl } from "xast";
import { localName } from "./xast_xml.ts";
import type { DtdIndex } from "./dtd_index.ts";

const IGNORE_ATTR_PREFIX = ["xmlns", "xml:", "xsi:"];

export function validateAgainstDtd(root: XEl, expectedRoot: string, dtd: DtdIndex): void {
  const errors: { path: string; msg: string }[] = [];
  walk(root, "", expectedRoot, dtd, errors);
  if (errors.length) {
    const msg = errors.map((e) => `- ${e.path}: ${e.msg}`).join("\n");
    throw new Error(`DTD validation failed:\n${msg}`);
  }
}

function walk(el: XEl, path: string, expectedRoot: string, dtd: DtdIndex, errors: { path: string; msg: string }[]) {
  const name = localName(el.name);
  const here = path ? `${path}/${name}` : `/${name}`;

  if (!path && name !== expectedRoot) {
    errors.push({ path: here, msg: `Root must be <${expectedRoot}>` });
  }

  const def = dtd.elements.get(name);
  if (!def) {
    errors.push({ path: here, msg: `Element <${name}> not declared in DTD` });
  } else {
    const attrs = Object.keys(el.attributes ?? {});
    for (const a of attrs) {
      if (IGNORE_ATTR_PREFIX.some((p) => a.startsWith(p))) continue;
      if (!def.declaredAttrs.has(a)) {
        errors.push({ path: here, msg: `Unknown attribute "${a}" on <${name}>` });
      }
    }
    for (const req of def.requiredAttrs) {
      if (!attrs.includes(req)) errors.push({ path: here, msg: `Missing required attribute "${req}" on <${name}>` });
    }

    const kids = (el.children.filter((c) => c.type === "element") as XEl[]);
    if (def.allowedChildren === "EMPTY" && kids.length) {
      errors.push({ path: here, msg: `<${name}> must be EMPTY` });
    } else if (def.allowedChildren !== "ANY" && def.allowedChildren !== "EMPTY") {
      for (const k of kids) {
        const kn = localName(k.name);
        if (!def.allowedChildren.has(kn)) {
          errors.push({ path: `${here}/${kn}`, msg: `Child <${kn}> not allowed under <${name}>` });
        }
      }
    }
  }

  for (const k of (el.children.filter((c) => c.type === "element") as XEl[])) {
    walk(k, here, expectedRoot, dtd, errors);
  }
}
