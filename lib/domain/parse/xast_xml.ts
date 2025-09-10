/**
 * XML → xast utilities (stream/token-based sanitization; no brittle slicing).
 * - Removes prolog (BOM, XML declaration, DOCTYPE)
 * - Repairs invalid comment bodies (no `--` inside)
 * - Scrubs invalid XML 1.0 chars from text
 * - Masks protected segments (CDATA, comments, PIs) during entity/angle transforms
 * - Normalizes entities & stray ampersands
 * - Applies *container-aware* text policies via a single streaming pass:
 *     • Inside configured containers (e.g. xs:documentation), preserve a rich set of HTML tags
 *       or escape/neutralize others, *and* escape stray bare '<' safely (math-safe).
 *     • Tracks inner allowed-tag stack to neutralize *stray closing tags* (fixes `&lt;p&gt; ... </p>`).
 *
 * Public surface:
 *   - preSanitize(xml, options?)
 *   - parseXmlToXast(xml, options?)
 *   - getRootElement, localName, getAttr, childElements, firstChild
 */

import { fromXml } from "xast-util-from-xml";
import type { Root, Element as XEl } from "xast";

/* ────────────────────────────── Types ────────────────────────────── */

export interface XmlSanitizeOptions {
  // Step toggles
  stripProlog?: boolean;                        // default true
  fixInvalidComments?: boolean;                 // default true
  scrubInvalidXmlChars?: boolean;               // default true

  // Entities
  entityPolicy?: "convert" | "escape" | "error"; // default "convert"
  namedEntities?: Record<string, number>;       // extend/override built-ins

  // Container policies
  /**
   * Container names where we treat content as "text-ish" but allow rich HTML tags.
   * Match is by *local name* (namespace-agnostic). Defaults include Writerside/Docs needs.
   * e.g. <xs:documentation>…</xs:documentation>
   */
  richTextContainers?: string[];                // default ["documentation", "link-summary", "card-summary", "web-summary"]

  /**
   * Container names where we want a stricter, inline-only set (legacy behavior).
   * Match by local name. Keep if you still rely on these.
   */
  inlineTextContainers?: string[];              // default ["p"]

  /**
   * If true, within any configured container we neutralize *all* tags (except the container’s own closer).
   * Useful for “treat everything as literal text” cases.
   */
  forceTextInContainers?: boolean;              // default false

  /**
   * When NOT forcing text: if true, unknown tags inside containers are turned into literal text (&lt;…&gt;).
   * Namespaced tags (like ac:image) are preserved by default.
   */
  escapeUnknownTagMentionsInText?: boolean;     // default true

  /**
   * Extra inline tags allowed inside *inline* containers (names are local, lowercased).
   * NOTE: block tags intentionally omitted here to avoid HTML-in-<p> oddities.
   */
  allowedInlineTags?: string[];                 // see DEFAULTS

  /**
   * Tags allowed inside *rich* containers (e.g., xs:documentation).
   * Includes a broad set of block + inline HTML-ish names.
   */
  allowedRichTags?: string[];                   // see DEFAULTS

  /**
   * Whether to escape bare '<' that are not part of a well-formed tag while inside containers.
   */
  escapeBareAnglesInText?: boolean;             // default true

  // Audit
  onChange?: (kind: string, detail: string) => void; // optional audit hook
}

const NOOP: (kind: string, detail: string) => void = () => {};

const ALLOW_INLINE_DEFAULT = [
  "a","em","strong","b","i","u","s","code","kbd","var","samp","sub","sup","span","small",
  "abbr","cite","q","mark","del","ins","br","img","tt"
];

const ALLOW_RICH_DEFAULT = [
  ...ALLOW_INLINE_DEFAULT,
  "p","pre","ul","ol","li","table","thead","tbody","tfoot","tr","td","th",
  "dl","dt","dd","blockquote","figure","figcaption","hr",
  "h1","h2","h3","h4","h5","h6"
];

const DEFAULTS: Required<Omit<XmlSanitizeOptions, "onChange">> & {
  onChange: NonNullable<XmlSanitizeOptions["onChange"]>;
} = {
  stripProlog: true,
  fixInvalidComments: true,
  scrubInvalidXmlChars: true,

  entityPolicy: "convert",
  namedEntities: {},

  richTextContainers: ["documentation", "link-summary", "card-summary", "web-summary"],
  inlineTextContainers: ["p"],
  forceTextInContainers: false,
  escapeUnknownTagMentionsInText: true,
  allowedInlineTags: ALLOW_INLINE_DEFAULT,
  allowedRichTags: ALLOW_RICH_DEFAULT,
  escapeBareAnglesInText: true,

  onChange: NOOP,
};

/* ────────────────────── Utilities: chars, names, fences ────────────────────── */

function isAlphaNum(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (
    (c >= 48 && c <= 57) || // 0-9
    (c >= 65 && c <= 90) || // A-Z
    (c >= 97 && c <= 122) || // a-z
    ch === "_" || ch === ":" || ch === "-" || ch === "."
  );
}

export function localName(qname: string): string {
  const i = qname.indexOf(":");
  return i >= 0 ? qname.slice(i + 1) : qname;
}

/** Remove leading/trailing Markdown fences. */
function stripCodeFences(input: string): string {
  let s = input;

  const start = s.match(/^\s*(?:(```+|~~~+)[^\n]*\n|``[^\n]*\n)/);
  if (start) s = s.slice(start[0].length);

  s = s.replace(/\n(?:```+|~~~+)\s*$/, "");
  s = s.replace(/\n``\s*$/, "");
  return s;
}

function startsWithAt(s: string, i: number, marker: string): boolean {
  return s.slice(i, i + marker.length) === marker;
}

/* ────────────────────── Prolog & structural scrubs ────────────────────── */

function stripProlog(input: string): string {
  let i = 0;
  if (input.charCodeAt(0) === 0xFEFF) i = 1; // BOM
  let s = input.slice(i);

  while (true) {
    let advanced = false;

    // leading whitespace
    let j = 0;
    while (j < s.length && /\s/.test(s[j]!)) j++;
    if (j) { s = s.slice(j); advanced = true; }

    // <?xml ...?>
    if (s.startsWith("<?xml")) {
      const end = s.indexOf("?>");
      if (end >= 0) { s = s.slice(end + 2); advanced = true; continue; }
    }

    // <!DOCTYPE ... [ ... ]>
    if (s.startsWith("<!DOCTYPE")) {
      const gt = s.indexOf(">");
      const br = s.indexOf("[");
      if (gt >= 0 && (br < 0 || br > gt)) {
        s = s.slice(gt + 1); advanced = true; continue;
      }
      if (br >= 0) {
        const endSubset = s.indexOf("]>");
        if (endSubset >= 0) {
          s = s.slice(endSubset + 2); advanced = true; continue;
        }
      }
    }

    if (!advanced) break;
  }
  return s;
}

function repairInvalidComments(s: string): string {
  // Replace `--` inside comments with `- -` (keeps length stable-ish)
  let out = "";
  let i = 0;
  while (i < s.length) {
    const open = s.indexOf("<!--", i);
    if (open < 0) { out += s.slice(i); break; }
    out += s.slice(i, open);
    const close = s.indexOf("-->", open + 4);
    if (close < 0) { out += s.slice(open); break; }
    const body = s.slice(open + 4, close).replace(/--/g, "- -");
    out += "<!--" + body + "-->";
    i = close + 3;
  }
  return out;
}

function scrubInvalidXmlCharsInText(s: string): string {
  // Remove C0 controls except TAB, LF, CR; also remove FFFE/FFFF
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (
      (code >= 0x00 && code <= 0x08) ||
      code === 0x0B || code === 0x0C ||
      (code >= 0x0E && code <= 0x1F) ||
      code === 0xFFFE || code === 0xFFFF
    ) continue;
    out += s[i]!;
  }
  return out;
}

/* ────────────────────── Protected-segment masking ────────────────────── */

type Masked = { text: string; restore: (t: string) => string };

function maskProtectedSegments(s: string): Masked {
  const holes: string[] = [];
  const token = (k: number) => `\u0000__HOLE_${k}__\u0000`;
  let out = "";
  let i = 0;

  while (i < s.length) {
    const lt = s.indexOf("<", i);
    if (lt < 0) { out += s.slice(i); break; }
    out += s.slice(i, lt);

    if (startsWithAt(s, lt, "<![CDATA[")) {
      const end = s.indexOf("]]>", lt + 9);
      if (end >= 0) { holes.push(s.slice(lt, end + 3)); out += token(holes.length - 1); i = end + 3; continue; }
    }
    if (startsWithAt(s, lt, "<?")) {
      const end = s.indexOf("?>", lt + 2);
      if (end >= 0) { holes.push(s.slice(lt, end + 2)); out += token(holes.length - 1); i = end + 2; continue; }
    }
    if (startsWithAt(s, lt, "<!--")) {
      const end = s.indexOf("-->", lt + 4);
      if (end >= 0) { holes.push(s.slice(lt, end + 3)); out += token(holes.length - 1); i = end + 3; continue; }
    }

    out += "<"; i = lt + 1;
  }

  const restore = (t: string) =>
    t.replace(/\u0000__HOLE_(\d+)__\u0000/g, (_m, n) => holes[Number(n)]!);

  return { text: out, restore };
}

/* ────────────────────── Entities & ampersands ────────────────────── */

const XML5 = new Set(["lt", "gt", "amp", "quot", "apos"]);
const BUILTIN_ENTITIES: Record<string, number> = {
  nbsp: 160, thinsp: 8201, ensp: 8194, emsp: 8195, shy: 173,
  ndash: 8211, mdash: 8212, hellip: 8230, middot: 183, bull: 8226,
  copy: 169, reg: 174, trade: 8482, euro: 8364, pound: 163, yen: 165,
  sect: 167, para: 182, deg: 176, sup1: 185, sup2: 178, sup3: 179,
  laquo: 171, raquo: 187, lsquo: 8216, rsquo: 8217, ldquo: 8220, rdquo: 8221,
  larr: 8592, uarr: 8593, rarr: 8594, darr: 8595, harr: 8596, times: 215, divide: 247,
};

function normalizeEntitiesAndAmpersands(
  s: string,
  entityPolicy: XmlSanitizeOptions["entityPolicy"],
  entityMap: Record<string, number>,
  onChange: (kind: string, detail: string) => void,
): string {
  let out = "";

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch !== "&") { out += ch; continue; }

    // Numeric ref
    if (s[i + 1] === "#") {
      let j = i + 2, isHex = false;
      if (s[j] === "x" || s[j] === "X") { isHex = true; j++; }
      let digits = "";
      while (j < s.length && ((isHex && /[0-9A-Fa-f]/.test(s[j]!)) || (!isHex && /[0-9]/.test(s[j]!)))) {
        digits += s[j]!;
        j++;
      }
      if (digits && s[j] === ";") { out += s.slice(i, j + 1); i = j; continue; }
      out += "&amp;"; continue; // stray '&' before a broken numeric entity
    }

    // Named entity
    let j = i + 1, name = "";
    if (/[A-Za-z]/.test(s[j]!)) {
      name += s[j]!; j++;
      while (j < s.length && isAlphaNum(s[j]!)) { name += s[j]!; j++; }
      if (s[j] === ";") {
        const lower = name.toLowerCase();
        if (XML5.has(lower)) {
          out += `&${lower};`;
        } else if (entityMap[lower] != null) {
          const code = entityMap[lower]!;
          out += `&#${code};`; onChange("entity", `&${name};→&#${code};`);
        } else {
          if (entityPolicy === "error") throw new Error(`[authord] Unknown named entity: &${name};`);
          // "convert" and "escape" both fall through to escaping the ampersand to be safe
          out += `&amp;${name};`; onChange("entity-unknown", `&${name};→&amp;${name};`);
        }
        i = j; continue;
      }
    }

    // Bare ampersand
    out += "&amp;";
  }
  return out;
}

/* ────────────────────── Tag tokenizer (quote-aware) ────────────────────── */

type DetailedTag =
  | { valid: true; end: number; qname: string; local: string; closing: boolean; selfClosing: boolean }
  | { valid: false; end: number };

function parseTagDetailed(s: string, lt: number): DetailedTag {
  let i = lt + 1;
  if (i >= s.length) return { valid: false, end: lt + 1 };

  let closing = false;
  if (s[i] === "/") { closing = true; i++; }

  const c0 = s[i];
  if (!c0 || !(/[A-Za-z_]/.test(c0))) return { valid: false, end: lt + 1 };

  let name = "";
  while (i < s.length && /[\w:.\-]/.test(s[i]!)) { name += s[i]!; i++; }
  const qname = name;
  const local = localName(name).toLowerCase();

  let quote: string | null = null;
  let selfClosing = false;
  let lastNonWs: string | null = null;

  while (i < s.length) {
    const ch = s[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; i++; continue; }
    if (ch === ">") {
      selfClosing = (lastNonWs === "/");
      return { valid: true, end: i + 1, qname, local, closing, selfClosing };
    }
    if (ch === "<") { return { valid: false, end: lt + 1 }; } // nested '<' before closing
    if (!/\s/.test(ch)) lastNonWs = ch;
    i++;
  }
  return { valid: false, end: lt + 1 };
}

/* ─────────────── Streaming container-aware transform (core redesign) ─────────────── */

function applyContainerPoliciesStream(
  s: string,
  o: Required<Pick<
    XmlSanitizeOptions,
    | "richTextContainers"
    | "inlineTextContainers"
    | "forceTextInContainers"
    | "escapeUnknownTagMentionsInText"
    | "allowedInlineTags"
    | "allowedRichTags"
    | "escapeBareAnglesInText"
  >>,
): string {
  const richNames = new Set(o.richTextContainers.map(x => x.toLowerCase()));
  const inlineNames = new Set(o.inlineTextContainers.map(x => x.toLowerCase()));

  const allowInline = new Set(o.allowedInlineTags.map(x => x.toLowerCase()));
  const allowRich = new Set(o.allowedRichTags.map(x => x.toLowerCase()));

  type Ctx = {
    kind: "rich" | "inline";
    nameLocal: string;           // container's local name
    innerStack: string[];        // allowed inner tags stack to validate closers
  };

  const ctxStack: Ctx[] = [];
  const top = () => ctxStack[ctxStack.length - 1];

  const isContainerOpen = (local: string) =>
    richNames.has(local) || inlineNames.has(local);

  const containerKindOf = (local: string): Ctx["kind"] =>
    richNames.has(local) ? "rich" : "inline";

  const allowedForKind = (kind: Ctx["kind"]) =>
    kind === "rich" ? allowRich : allowInline;

  let out = "";
  let i = 0;

  while (i < s.length) {
    const ch = s[i]!;
    if (ch !== "<") {
      out += ch;
      i++;
      continue;
    }

    const tag = parseTagDetailed(s, i);
    if (!tag.valid) {
      // Bare '<' (not a complete tag)
      if (ctxStack.length && o.escapeBareAnglesInText) {
        out += "&lt;";
        i++; // do not swallow more; keep scanning
      } else {
        out += "<";
        i++;
      }
      continue;
    }

    // We have a well-formed tag token [i, tag.end)
    const tagText = s.slice(i, tag.end);
    const current = top();

    // Handle container enter/exit regardless of forceTextInContainers
    if (!tag.closing && isContainerOpen(tag.local)) {
      // opening a container
      ctxStack.push({ kind: containerKindOf(tag.local), nameLocal: tag.local, innerStack: [] });
      out += tagText;
      i = tag.end;
      continue;
    }

    if (tag.closing && current && tag.local === current.nameLocal) {
      // closing current container
      out += tagText;
      ctxStack.pop();
      i = tag.end;
      continue;
    }

    // Inside any container?
    if (current) {
      if (o.forceTextInContainers) {
        // Neutralize everything inside, except container's own closing (handled above).
        out += "&lt;" + tagText.slice(1, -1).replace(/</g, "&lt;").replace(/>/g, "&gt;") + "&gt;";
        i = tag.end;
        continue;
      }

      // Not forced → keep allowed sets; preserve namespaced tags by default.
      const allowSet = allowedForKind(current.kind);
      const isNamespaced = tag.qname.includes(":");

      if (isNamespaced) {
        // keep namespaced tags intact (authors often embed ac:, ri:, etc.)
        if (!tag.closing && !tag.selfClosing) current.innerStack.push(tag.local);
        if (tag.closing) {
          if (current.innerStack[current.innerStack.length - 1] === tag.local) current.innerStack.pop();
          else {
            // stray closer for namespaced tag → neutralize
            out += `&lt;/${tag.qname}&gt;`;
            i = tag.end;
            continue;
          }
        }
        out += tagText;
        i = tag.end;
        continue;
      }

      // Non-namespaced: allowed?
      const allowed = allowSet.has(tag.local);
      if (allowed) {
        if (!tag.closing && !tag.selfClosing) current.innerStack.push(tag.local);
        if (tag.closing) {
          // only accept if it matches current stack top; else neutralize stray closer
          if (current.innerStack[current.innerStack.length - 1] === tag.local) current.innerStack.pop();
          else {
            out += `&lt;/${tag.qname}&gt;`;
            i = tag.end;
            continue;
          }
        }
        out += tagText;
        i = tag.end;
        continue;
      }

      // Unknown tag mention inside container
      if (o.escapeUnknownTagMentionsInText) {
        // turn ENTIRE tag to literal text
        out += "&lt;" + tagText.slice(1, -1).replace(/</g, "&lt;").replace(/>/g, "&gt;") + "&gt;";
        i = tag.end;
        continue;
      } else {
        // allow as-is
        out += tagText;
        i = tag.end;
        continue;
      }
    }

    // Outside containers: pass through
    out += tagText;
    i = tag.end;
  }

  return out;
}

/* ───────────────────────── Public sanitize API ───────────────────────── */

export function preSanitize(xml: string, opts: XmlSanitizeOptions = {}): string {
  const o = { ...DEFAULTS, ...opts };
  const entities = { ...BUILTIN_ENTITIES, ...o.namedEntities };
  const log = o.onChange ?? NOOP;

  const s0 = stripCodeFences(xml);

  // 1) Prolog/doctype/comment/char scrubs
  let s = o.stripProlog ? stripProlog(s0) : s0;
  if (o.fixInvalidComments) s = repairInvalidComments(s);
  if (o.scrubInvalidXmlChars) s = scrubInvalidXmlCharsInText(s);

  // 2) Mask protected segments while we normalize entities/angles
  const masked = maskProtectedSegments(s);
  let work = masked.text;

  // 3) Entities / ampersands
  work = normalizeEntitiesAndAmpersands(work, o.entityPolicy, entities, log);

  // 4) Container-aware streaming transform (core)
  work = applyContainerPoliciesStream(work, {
    richTextContainers: o.richTextContainers,
    inlineTextContainers: o.inlineTextContainers,
    forceTextInContainers: o.forceTextInContainers,
    escapeUnknownTagMentionsInText: o.escapeUnknownTagMentionsInText,
    allowedInlineTags: o.allowedInlineTags,
    allowedRichTags: o.allowedRichTags,
    escapeBareAnglesInText: o.escapeBareAnglesInText,
  });

  // 5) Restore masked segments
  s = masked.restore(work);
  return s;
}

/* ───────────────────────── Parse & helpers ───────────────────────── */

export function parseXmlToXast(xml: string, opts?: XmlSanitizeOptions): Root {
  const sanitized = preSanitize(xml, opts);
  try {
    return fromXml(sanitized);
  } catch (err: unknown) {
    const msg = (err as { message?: string })?.message ?? String(err);
    const m = msg.match(/line\s+(\d+),\s*column\s+(\d+)/i);
    const where = m ? ` (at line ${m[1]}, column ${m[2]})` : "";
    console.error(`[authord] XML parse error${where}: ${msg}`);
    throw new Error(`[authord] XML parse error${where}: ${msg}`);
  }
}

export function getRootElement(ast: Root): XEl {
  const el = ast.children.find((n) => n.type === "element") as XEl | undefined;
  if (!el) throw new Error("XML has no root element");
  return el;
}

export function getAttr(el: XEl, name: string): string | undefined {
  return (el.attributes?.[name] as string | undefined) ?? undefined;
}

export function childElements(el: XEl, name?: string): XEl[] {
  const local = (q: string) => {
    const i = q.indexOf(":");
    return i >= 0 ? q.slice(i + 1) : q;
  };
  return (el.children.filter((c) => c.type === "element") as XEl[])
    .filter((c) => (name ? local(c.name) === name : true));
}

export function firstChild(el: XEl, name: string): XEl | undefined {
  return childElements(el, name)[0];
}
