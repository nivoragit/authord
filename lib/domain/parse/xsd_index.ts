// xsd_index.ts
// Build in-memory index from XSD
import type { Root, Element as XEl, Node } from "xast";
import { parseXmlToXast, localName } from "./xast_xml.ts";

export type AttrUse = "required" | "optional";
export type XsdElementDef = { name: string; attributes: Map<string, AttrUse>; allowedChildren: Set<string> };

export type XsdIndex = {
  elements: Map<string, XsdElementDef>;
  attributes: Map<string, AttrUse>;                 // global attributes (by name)
  groups: Map<string, Set<string>>;                 // xs:group name -> element names reachable
  attributeGroups: Map<string, Map<string, AttrUse>>; // xs:attributeGroup name -> attrs
};

function isEl(n: Node, ln?: string): n is XEl {
  return n.type === "element" && (!ln || localName((n as XEl).name) === ln);
}
function attr(e: XEl, k: string) { return e.attributes?.[k] as string | undefined; }

/** Build an approximate XSD index that understands:
 *  - top-level xs:element (inline complexType)
 *  - xs:group and nested group refs
 *  - xs:attribute (inline & ref) and xs:attributeGroup refs
 * This is purpose-built for structural allow/deny validation — it does not enforce order/min/max.
 */
export function buildXsdIndex(xsdXml: string): XsdIndex {
  const ast: Root = parseXmlToXast(xsdXml);
  const schema = ast.children.find((n) => isEl(n, "schema")) as XEl | undefined;
  if (!schema) throw new Error("XSD: no <xs:schema>");

  const elements = new Map<string, XsdElementDef>();
  const attributes = new Map<string, AttrUse>();

  // --- 1) collect top-level global attributes (by name) ---
  for (const n of schema.children) {
    if (!isEl(n)) continue;
    if (localName(n.name) === "attribute" && attr(n, "name")) {
      attributes.set(attr(n, "name")!, (attr(n, "use") as AttrUse) ?? "optional");
    }
  }

  // --- 2) collect xs:attributeGroup definitions (lazy-resolved) ---
  const attributeGroupEls = new Map<string, XEl>();
  for (const n of schema.children) {
    if (!isEl(n, "attributeGroup")) continue;
    const name = attr(n, "name");
    if (name) attributeGroupEls.set(name, n);
  }
  const attributeGroups = new Map<string, Map<string, AttrUse>>();
  function resolveAttrGroup(name: string, seen = new Set<string>()): Map<string, AttrUse> {
    if (attributeGroups.has(name)) return attributeGroups.get(name)!;
    if (seen.has(name)) return new Map(); // break cycles defensively
    seen.add(name);
    const host = attributeGroupEls.get(name);
    const out = new Map<string, AttrUse>();
    if (host) {
      for (const c of host.children) {
        if (!isEl(c)) continue;
        const ln = localName(c.name);
        if (ln === "attribute") {
          const nm = attr(c, "name") ?? localName(attr(c, "ref") ?? "");
          if (nm) out.set(nm, (attr(c, "use") as AttrUse) ?? "optional");
        } else if (ln === "attributeGroup") {
          const ref = localName(attr(c, "ref") ?? "");
          if (ref) {
            const nested = resolveAttrGroup(ref, seen);
            for (const [k, v] of nested) out.set(k, v);
          }
        }
      }
    }
    attributeGroups.set(name, out);
    return out;
  }
  // pre-resolve everything once (optional, speeds up later lookups)
  for (const k of attributeGroupEls.keys()) resolveAttrGroup(k);

  // --- 3) collect xs:group definitions (element sets) ---
  const groupEls = new Map<string, XEl>();
  for (const n of schema.children) {
    if (!isEl(n, "group")) continue;
    const name = attr(n, "name");
    if (name) groupEls.set(name, n);
  }
  const groups = new Map<string, Set<string>>();
  function collectGroup(name: string, seen = new Set<string>()): Set<string> {
    if (groups.has(name)) return groups.get(name)!;
    if (seen.has(name)) return new Set(); // break cycles defensively
    seen.add(name);
    const host = groupEls.get(name);
    const out = new Set<string>();
    if (host) {
      for (const c of host.children) {
        if (!isEl(c)) continue;
        scanContentModel(c, out, seen);
      }
    }
    groups.set(name, out);
    return out;
  }
  // resolve all groups
  for (const k of groupEls.keys()) collectGroup(k);

  // --- 4) collect top-level xs:element definitions, recording attrs & allowed children ---
  for (const n of schema.children) {
    if (!isEl(n, "element")) continue;
    const name = attr(n, "name");
    if (!name) continue;
    const def: XsdElementDef = { name, attributes: new Map(), allowedChildren: new Set() };

    const ct = n.children.find((c) => isEl(c, "complexType")) as XEl | undefined;
    if (ct) {
      collectAttrs(ct, def.attributes, attributeGroups);
      collectChildModels(ct, def.allowedChildren, groups);
    }
    elements.set(name, def);
  }

  return { elements, attributes, groups, attributeGroups };
}

/** Extract inline attributes, `ref` attributes, and resolve `attributeGroup ref=`. */
function collectAttrs(el: XEl, acc: Map<string, AttrUse>, attributeGroups: XsdIndex["attributeGroups"]) {
  for (const c of el.children) {
    if (!isEl(c)) continue;
    const ln = localName(c.name);
    if (ln === "attribute") {
      const name = (c.attributes?.["name"] as string | undefined);
      const ref = (c.attributes?.["ref"] as string | undefined);
      const use = ((c.attributes?.["use"] as AttrUse | undefined) ?? "optional") as AttrUse;
      if (name) acc.set(name, use);
      if (ref) acc.set(localName(ref), use);
    } else if (ln === "attributeGroup") {
      const ref = localName((c.attributes?.["ref"] as string | undefined) ?? "");
      if (ref && attributeGroups.has(ref)) {
        for (const [k, v] of attributeGroups.get(ref)!) acc.set(k, v);
      }
    } else {
      collectAttrs(c, acc, attributeGroups);
    }
  }
}

/** Traverse content model to find child element names. Handles sequence/choice/group/element (by ref or name). */
function collectChildModels(el: XEl, out: Set<string>, groups: XsdIndex["groups"]) {
  for (const c of el.children) {
    if (!isEl(c)) continue;
    scanContentModel(c, out, undefined, groups);
  }
}

function scanContentModel(node: XEl, out: Set<string>, seenGroups = new Set<string>(), groups?: XsdIndex["groups"]) {
  const ln = localName(node.name);
  if (ln === "sequence" || ln === "choice" || ln === "all") {
    for (const e of node.children) {
      if (!isEl(e)) continue;
      scanContentModel(e, out, seenGroups, groups);
    }
  } else if (ln === "group") {
    const ref = localName((node.attributes?.["ref"] as string | undefined) ?? "");
    if (ref && groups) {
      if (!seenGroups.has(ref)) {
        seenGroups.add(ref);
        const g = groups.get(ref);
        if (g) for (const nm of g) out.add(nm);
      }
    }
  } else if (ln === "element") {
    const nm = localName(
      (node.attributes?.["ref"] as string | undefined) ??
      (node.attributes?.["name"] as string | undefined) ??
      "",
    );
    if (nm) out.add(nm);
  } else {
    // recurse through any other wrapper (complexType, simpleContent, etc.)
    for (const e of node.children) {
      if (!isEl(e)) continue;
      scanContentModel(e, out, seenGroups, groups);
    }
  }
}

/** Build the element-name set for a `<xs:group name="...">` body recursively. */
function scanGroupBody(el: XEl, out: Set<string>, seen: Set<string>, groupEls?: Map<string, XEl>) {
  for (const c of el.children) {
    if (!isEl(c)) continue;
    const ln = localName(c.name);
    if (ln === "sequence" || ln === "choice" || ln === "all") {
      scanGroupBody(c, out, seen, groupEls);
    } else if (ln === "group") {
      const ref = localName((c.attributes?.["ref"] as string | undefined) ?? "");
      if (ref && groupEls && !seen.has(ref)) {
        seen.add(ref);
        const g = groupEls.get(ref);
        if (g) scanGroupBody(g, out, seen, groupEls);
      }
    } else if (ln === "element") {
      const nm = localName(
        (c.attributes?.["ref"] as string | undefined) ??
        (c.attributes?.["name"] as string | undefined) ??
        "",
      );
      if (nm) out.add(nm);
    } else {
      scanGroupBody(c, out, seen, groupEls);
    }
  }
}
