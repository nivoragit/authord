// dtd_index.ts
// Build in-memory index from DTD
export type DtdElement = {
  name: string;
  allowedChildren: Set<string> | "ANY" | "EMPTY";
  declaredAttrs: Set<string>;
  requiredAttrs: Set<string>;
};

export type DtdIndex = { elements: Map<string, DtdElement> };

/** Extremely small DTD parser: ELEMENT & ATTLIST (enough for the provided sample). */
export function buildDtdIndex(dtd: string): DtdIndex {
  const elements = new Map<string, DtdElement>();

  // ELEMENT declarations
  const elemRe = /<!ELEMENT\s+([A-Za-z][\w\-]*)\s+([^>]+)>/g;
  for (const m of dtd.matchAll(elemRe)) {
    const name = m[1];
    const model = m[2].trim();
    let allowed: DtdElement["allowedChildren"];
    if (/EMPTY/.test(model)) allowed = "EMPTY";
    else if (/ANY/.test(model)) allowed = "ANY";
    else {
      // collect names inside content model; ignore #PCDATA, punctuation, quantifiers
      const names = new Set<string>();
      for (const n of model.matchAll(/[A-Za-z][\w\-]*/g)) {
        const token = n[0];
        if (token === "PCDATA") continue;
        names.add(token);
      }
      allowed = names;
    }
    elements.set(name, {
      name,
      allowedChildren: allowed,
      declaredAttrs: new Set(),
      requiredAttrs: new Set(),
    });
  }

  // ATTLIST declarations (can repeat for same element)
  const attRe = /<!ATTLIST\s+([A-Za-z][\w\-]*)\s+([\s\S]*?)>/g;
  for (const m of dtd.matchAll(attRe)) {
    const name = m[1];
    const body = m[2];
    const def = elements.get(name) ?? {
      name,
      allowedChildren: "ANY" as const,
      declaredAttrs: new Set(),
      requiredAttrs: new Set(),
    };
    // split attributes triplets roughly: attrName ... (#REQUIRED|#IMPLIED|default)
    for (const line of body.split(/\n/)) {
      const mm = line.trim().match(/^([A-Za-z][\w\-]*)\s+.+?\s+(#REQUIRED|#IMPLIED|".*?"|\'.*?\'|\S+)/);
      if (!mm) continue;
      const attrName = mm[1];
      const req = mm[2] === "#REQUIRED";
      def.declaredAttrs.add(attrName);
      if (req) def.requiredAttrs.add(attrName);
    }
    elements.set(name, def);
  }

  return { elements };
}
