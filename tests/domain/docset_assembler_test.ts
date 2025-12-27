// deno-lint-ignore-file no-explicit-any
import {
  assert,
  assertEquals,
  assertExists,
  assertMatch,
} from "std/assert";
import { AuthordAstAssembler } from "../../lib/core/application/authord_ast_assembler.ts";
import { makeLocalFirstCachingFetcher } from "../../lib/utils/schema_fetcher.ts";


/* ───────────────────────── helpers: tiny xast builders ─────────────────── */

type Text = { type: "text"; value: string };
type XEl = {
  type: "element";
  name: string;
  attributes?: Record<string, string>;
  children: any[]; // ElementContent (keep light here)
};

const fetcher = makeLocalFirstCachingFetcher({
  // todo: hardcoded paths; make configurable later?
  cacheMap: {
    "https://resources.jetbrains.com/writerside/1.0/writerside-cfg.xsd":
      "cfg/schemas/writerside-cfg.xsd",
    "https://resources.jetbrains.com/writerside/1.0/ihp.dtd":
      "cfg/schemas/ihp.dtd",

    // add others your project uses:
    "https://resources.jetbrains.com/writerside/1.0/product-profile.dtd":
      "cfg/schemas/instance-profile.dtd",

    // "https://resources.jetbrains.com/writerside/1.0/topic.xsd":
    //   "cfg/schemas/topic.xsd",
  },
  allowNetwork: true, // local-first; downloads if missing
});

const text = (v: string): Text => ({ type: "text", value: v });
const el = (name: string, attrs: Record<string, string> = {}, children: any[] = []): XEl => ({
  type: "element",
  name,
  attributes: attrs,
  children,
});
const p = (s: string) => el("p", {}, [text(s)]);

/* ─────────────────── helpers: inspect xast in assertions ───────────────── */

function findAll(root: XEl, name: string): XEl[] {
  const out: XEl[] = [];
  (function walk(n: any) {
    if (!n) return;
    if (n.type === "element") {
      if (n.name === name) out.push(n);
      for (const c of n.children) walk(c);
    }
  })(root);
  return out;
}
function firstText(root: XEl): string | undefined {
  let found: string | undefined;
  (function walk(n: any) {
    if (found) return;
    if (n?.type === "text") { found = n.value; return; }
    if (n?.type === "element") for (const c of n.children) walk(c);
  })(root);
  return found;
}
function findElementByAttr(root: XEl, name: string, attr: string, val: string): XEl | undefined {
  return findAll(root, name).find((e) => e.attributes?.[attr] === val);
}
function getCodeBlockText(cb: XEl): string {
  const texts = (cb.children as any[]).filter((c) => c.type === "text");
  const txt = texts[texts.length - 1];
  return txt?.value ?? "";
}

function childTagNames(n: XEl): string[] {
  return n.children.filter((c: any) => c.type === "element").map((c: any) => c.name);
}

/* ─────────────── fakes: WritersideCfg/Instance/Topic parsers ───────────── */

class FakeCfgParser {
  constructor(private cfg: any) {}
  async parse(_xml: string) { return this.cfg; }
}
class FakeInstanceProfileParser {
  constructor(private ast: XEl) {}
  async parse(_xml: string): Promise<XEl> { return this.ast; }
}
class FakeTopicParser {
  constructor(private registry: Map<string, XEl>) {}
  async parse(xml: string): Promise<XEl> {
    const ast = this.registry.get(xml);
    if (!ast) throw new Error("FakeTopicParser: unknown xml key: " + xml);
    return ast;
  }
}

/* ─────────────────────────── fake in-memory fs ─────────────────────────── */

function makeResource(files: Record<string, string>) {
  return {
    async readText(path: string) {
      const v = files[path];
      if (v === undefined) throw new Error("ENOENT: " + path);
      return v;
    },
    async exists(path: string) {
      return files[path] !== undefined; // strict key check
    },
    resolve(base: string, target: string) {
      if (/^https?:\/\//i.test(target)) return target;
      if (target.startsWith("/")) return target;
      const baseDir = base.endsWith("/") ? base : base.replace(/[^/]+$/, "");
      return baseDir + target.replace(/^\.\//, "");
    },
  };
}

/* ──────────────────────────────── tests ────────────────────────────────── */

Deno.test("include: basic replacement injects referenced element's *content* (not wrapper)", async () => {
  const cfgPath = "/root/writerside.cfg";

  // Topics:
  // A: has <include from="B.topic" element-id="b1"/>
  const A = el("topic", { id: "A" }, [
    p("Intro"),
    el("include", { from: "B.topic", "element-id": "b1" }),
  ]);
  // B: chapter#b1 holds a <p> payload that must be inlined into A
  const B = el("topic", { id: "B" }, [
    el("chapter", { id: "b1" }, [p("Inside B1")]),
  ]);

  // Registry keys are the exact XML strings the assembler will read
  const topicReg = new Map<string, XEl>([
    ["XML_A", A],
    ["XML_B", B],
  ]);

  const files = {
    [cfgPath]: "CFG",
    "/root/inst.tree": "INST",
    "/root/topics/A.topic": "XML_A",
    "/root/topics/B.topic": "XML_B",
  };

  const fakeCfg = {
    topicsDir: "/root/topics/",
    instances: [{ src: "inst.tree" }],
  };

  const instanceAst = el("instance-profile", {}, [
    el("toc-element", { topic: "A.topic" }),
  ]);

  const assembler = new AuthordAstAssembler(
    new FakeCfgParser(fakeCfg) as any,
    new FakeInstanceProfileParser(instanceAst) as any,
    new FakeTopicParser(topicReg) as any,
  );

  const out = await assembler.build({
    cfgPath,
    resource: makeResource(files) as any,
    fetcher,
  });

  // find page A
  const pageA = out.pages.find((p:any) => p.path.endsWith("/A.topic"))!;
  assertExists(pageA);
  const includeNodes = findAll(pageA.ast as any, "include");
  assertEquals(includeNodes.length, 0, "include should be gone (replaced)");

  // ensure the injected payload exists
  const pNodes = findAll(pageA.ast as any, "p");
  assert(pNodes.some((n) => firstText(n as any) === "Inside B1"));
});

Deno.test("include: nullable=true removes unresolved include; non-nullable leaves it", async () => {
  const cfgPath = "/root/writerside.cfg";

  // A1: includes missing, nullable=true => should be removed
  const A1 = el("topic", { id: "A1" }, [
    p("Intro"),
    el("include", { from: "Missing.topic", "element-id": "x", nullable: "true" }),
  ]);

  // A2: includes missing, no nullable => include stays
  const A2 = el("topic", { id: "A2" }, [
    p("Intro2"),
    el("include", { from: "Missing.topic", "element-id": "x" }),
  ]);

  const topicReg = new Map<string, XEl>([
    ["XML_A1", A1],
    ["XML_A2", A2],
  ]);

  const files = {
    [cfgPath]: "CFG",
    "/root/inst.tree": "INST",
    "/root/topics/A1.topic": "XML_A1",
    "/root/topics/A2.topic": "XML_A2",
    // Missing.topic intentionally absent
  };

  const fakeCfg = {
    topicsDir: "/root/topics/",
    instances: [{ src: "inst.tree" }],
  };
  const instanceAst = el("instance-profile", {}, [
    el("toc-element", { topic: "A1.topic" }),
    el("toc-element", { topic: "A2.topic" }),
  ]);

  const assembler = new AuthordAstAssembler(
    new FakeCfgParser(fakeCfg) as any,
    new FakeInstanceProfileParser(instanceAst) as any,
    new FakeTopicParser(topicReg) as any,
  );

  const out = await assembler.build({ cfgPath, resource: makeResource(files) as any, fetcher });

  const pageA1 = out.pages.find((p:any) => p.path.endsWith("/A1.topic"))!;
  const pageA2 = out.pages.find((p:any) => p.path.endsWith("/A2.topic"))!;
  assertEquals(findAll(pageA1.ast as any, "include").length, 0);
  assertEquals(findAll(pageA2.ast as any, "include").length, 1);
});

Deno.test("include: multi-pass (fixed-point) resolves nested include brought in via payload", async () => {
  const cfgPath = "/root/w.cfg";

  // A -> include B#slot ; B#slot contains include of C#leaf
  const A = el("topic", {}, [
    el("include", { from: "B.topic", "element-id": "slot" }),
  ]);
  const B = el("topic", {}, [
    el("chapter", { id: "slot" }, [
      el("include", { from: "C.topic", "element-id": "leaf" }),
    ]),
  ]);
  const C = el("topic", {}, [
    el("p", { id: "leaf" }, [text("Deep content")]),
  ]);

  const topicReg = new Map<string, XEl>([
    ["A_XML", A],
    ["B_XML", B],
    ["C_XML", C],
  ]);

  const files = {
    [cfgPath]: "CFG",
    "/root/i.tree": "INST",
    "/root/topics/A.topic": "A_XML",
    "/root/topics/B.topic": "B_XML",
    "/root/topics/C.topic": "C_XML",
  };

  const fakeCfg = { topicsDir: "/root/topics/", instances: [{ src: "i.tree" }] };
  const instAst = el("instance-profile", {}, [el("toc-element", { topic: "A.topic" })]);

  const assembler = new AuthordAstAssembler(
    new FakeCfgParser(fakeCfg) as any,
    new FakeInstanceProfileParser(instAst) as any,
    new FakeTopicParser(topicReg) as any,
  );

  const out = await assembler.build({ cfgPath, resource: makeResource(files) as any , fetcher});

  const pageA = out.pages.find((p:any) => p.path.endsWith("/A.topic"))!;
  assertMatch(firstText(pageA.ast as any) ?? "", /Deep content/);
});

Deno.test("include: depth guard stops after maxIncludeDepth", async () => {
  const cfgPath = "/root/w.cfg";

  const A = el("topic", {}, [
    el("include", { from: "B.topic", "element-id": "slot" }),
  ]);
  const B = el("topic", {}, [
    el("p", { id: "slot" }, [
      el("include", { from: "C.topic", "element-id": "leaf" }),
    ]),
  ]);
  const C = el("topic", {}, [el("p", { id: "leaf" }, [text("Deep")])]);

  const topicReg = new Map<string, XEl>([
    ["A_XML", A],
    ["B_XML", B],
    ["C_XML", C],
  ]);

  const files = {
    [cfgPath]: "CFG",
    "/root/i.tree": "INST",
    "/root/topics/A.topic": "A_XML",
    "/root/topics/B.topic": "B_XML",
    "/root/topics/C.topic": "C_XML",
  };

  const fakeCfg = { topicsDir: "/root/topics/", instances: [{ src: "i.tree" }] };
  const instAst = el("instance-profile", {}, [el("toc-element", { topic: "A.topic" })]);

  const assembler = new AuthordAstAssembler(
    new FakeCfgParser(fakeCfg) as any,
    new FakeInstanceProfileParser(instAst) as any,
    new FakeTopicParser(topicReg) as any,
  );

  // maxIncludeDepth = 1 => only the first include resolves; the nested include remains
  const out = await assembler.build({
    cfgPath,
    resource: makeResource(files) as any,
    maxIncludeDepth: 1,
    fetcher,
  });

  const pageA = out.pages.find((p:any) => p.path.endsWith("/A.topic"))!;
  // A should now contain the include element that came from B (unresolved)
  assertEquals(findAll(pageA.ast as any, "include").length, 1);
});

Deno.test("code-block: injects text; preserves non-text children; removes existing text nodes", async () => {
  const cfgPath = "/root/w.cfg";

  const A = el("topic", {}, [
    el("code-block", { src: "/snips/file.php", "include-lines": "2-3" }, [
      text("to be removed"),
      el("note", {}, [text("keep me")]),
    ]),
  ]);

  const topicReg = new Map<string, XEl>([["A_XML", A]]);
  const files = {
    [cfgPath]: "CFG",
    "/root/i.tree": "INST",
    "/root/topics/A.topic": "A_XML",
    "/snips/file.php":
      [
        "L1 first",
        "L2 second",
        "L3 third",
        "L4 fourth",
      ].join("\n"),
  };

  const fakeCfg = { topicsDir: "/root/topics/", instances: [{ src: "i.tree" }] };
  const instAst = el("instance-profile", {}, [el("toc-element", { topic: "A.topic" })]);

  const assembler = new AuthordAstAssembler(
    new FakeCfgParser(fakeCfg) as any,
    new FakeInstanceProfileParser(instAst) as any,
    new FakeTopicParser(topicReg) as any,
  );

  const out = await assembler.build({
    cfgPath,
    resource: makeResource(files) as any,
    fetcher,
  });

  const pageA = out.pages.find((p:any) => p.path.endsWith("/A.topic"))!;
  const cb = findAll(pageA.ast as any, "code-block")[0];
  assertExists(cb);

  // non-text child ("note") preserved
  assertEquals(childTagNames(cb).includes("note"), true);

  // only ONE text node remains with lines 2..3
  const textChildren = (cb.children as any[]).filter((c) => c.type === "text");
  assertEquals(textChildren.length, 1);
  assertMatch(textChildren[0].value, /L2 second\nL3 third$/);
});

Deno.test("code-block: include-lines variants (single, open-range, comma list)", async () => {
  const cfgPath = "/root/w.cfg";

  const mkCB = (spec: string, name: string) =>
    el("code-block", { src: "/snips/x.txt", "include-lines": spec }, [text(name)]);

  const A = el("topic", {}, [
    mkCB("3", "single"),
    mkCB("2-", "open"),
    mkCB("1,3,5", "list"),
  ]);

  const topicReg = new Map<string, XEl>([["A_XML", A]]);
  const files = {
    [cfgPath]: "CFG",
    "/root/i.tree": "INST",
    "/root/topics/A.topic": "A_XML",
    "/snips/x.txt": ["A", "B", "C", "D", "E"].join("\n"),
  };

  const fakeCfg = { topicsDir: "/root/topics/", instances: [{ src: "i.tree" }] };
  const instAst = el("instance-profile", {}, [el("toc-element", { topic: "A.topic" })]);

  const assembler = new AuthordAstAssembler(
    new FakeCfgParser(fakeCfg) as any,
    new FakeInstanceProfileParser(instAst) as any,
    new FakeTopicParser(topicReg) as any,
  );

  const out = await assembler.build({ cfgPath, resource: makeResource(files) as any, fetcher });

  const cbs = findAll(out.pages[0].ast as any, "code-block");

  // "3" -> single line C
  assertEquals(getCodeBlockText(cbs[0]), "C");
  // "2-" -> from B to end
  assertEquals(getCodeBlockText(cbs[1]), "B\nC\nD\nE");
  // "1,3,5" -> A, C, E newline joined
  assertEquals(getCodeBlockText(cbs[2]), "A\nC\nE");
});

Deno.test("markdown pages: are wrapped into <md-page> with content text", async () => {
  const cfgPath = "/root/w.cfg";

  const topicReg = new Map<string, XEl>([]);
  const files = {
    [cfgPath]: "CFG",
    "/root/i.tree": "INST",
    "/root/topics/Readme.md": "# hello\n",
  };

  const fakeCfg = { topicsDir: "/root/topics/", instances: [{ src: "i.tree" }] };
  const instAst = el("instance-profile", {}, [
    el("toc-element", { topic: "Readme.md" }),
  ]);

  const assembler = new AuthordAstAssembler(
    new FakeCfgParser(fakeCfg) as any,
    new FakeInstanceProfileParser(instAst) as any,
    new FakeTopicParser(topicReg) as any, // no topics in this test
  );

  const out = await assembler.build({ cfgPath, resource: makeResource(files) as any , fetcher});
  const md = out.pages.find((p:any) => p.kind === "markdown")!;
  assertExists(md);
  assertEquals((md.ast as any).name, "md-page");
  assertMatch(firstText(md.ast as any) ?? "", /^# hello/);
});

Deno.test("macros: applied to external code before injection", async () => {
  const cfgPath = "/root/w.cfg";

  const A = el("topic", {}, [
    el("code-block", { src: "/snips/z.txt" }, []),
  ]);
  const topicReg = new Map<string, XEl>([["A_XML", A]]);
  const files = {
    [cfgPath]: "CFG",
    "/root/i.tree": "INST",
    "/root/topics/A.topic": "A_XML",
    "/snips/z.txt": "AAA %FOO% BBB",
  };

  const fakeCfg = { topicsDir: "/root/topics/", instances: [{ src: "i.tree" }] };
  const instAst = el("instance-profile", {}, [el("toc-element", { topic: "A.topic" })]);

  const assembler = new AuthordAstAssembler(
    new FakeCfgParser(fakeCfg) as any,
    new FakeInstanceProfileParser(instAst) as any,
    new FakeTopicParser(topicReg) as any,
  );

  const out = await assembler.build({
    cfgPath,
    resource: makeResource(files) as any,
    macros: { FOO: "ZZ" },
    fetcher,
  });

  const cb = findAll(out.pages[0].ast as any, "code-block")[0];
  assertEquals(getCodeBlockText(cb), "AAA ZZ BBB");
});

Deno.test("preload include closure: loads referenced topics transitively only if exists()", async () => {
  const cfgPath = "/root/w.cfg";

  const A = el("topic", {}, [el("include", { from: "B.topic", "element-id": "x" })]);
  const B = el("topic", { id: "B" }, [el("p", { id: "x" }, [text("ok")])]);

  const topicReg = new Map<string, XEl>([
    ["A_XML", A],
    ["B_XML", B],
  ]);

  const filesPresent = {
    [cfgPath]: "CFG",
    "/root/i.tree": "INST",
    "/root/topics/A.topic": "A_XML",
    "/root/topics/B.topic": "B_XML",
  };

  const filesMissingB = {
    [cfgPath]: "CFG",
    "/root/i.tree": "INST",
    "/root/topics/A.topic": "A_XML",
    // B.topic intentionally absent
  };

  const fakeCfg = { topicsDir: "/root/topics/", instances: [{ src: "i.tree" }] };
  const instAst = el("instance-profile", {}, [el("toc-element", { topic: "A.topic" })]);

  // Case 1: B exists => include resolves
  const asm1 = new AuthordAstAssembler(
    new FakeCfgParser(fakeCfg) as any,
    new FakeInstanceProfileParser(instAst) as any,
    new FakeTopicParser(topicReg) as any,
  );
  const out1 = await asm1.build({ cfgPath, resource: makeResource(filesPresent) as any, fetcher });
  assertMatch(firstText(out1.pages[0].ast as any) ?? "", /ok/);

  // Case 2: B missing => include cannot resolve (no nullable) -> include remains
  const asm2 = new AuthordAstAssembler(
    new FakeCfgParser(fakeCfg) as any,
    new FakeInstanceProfileParser(instAst) as any,
    new FakeTopicParser(topicReg) as any,
  );
  const out2 = await asm2.build({ cfgPath, resource: makeResource(filesMissingB) as any, fetcher });
  const unresolvedIncludes = findAll(out2.pages[0].ast as any, "include").length;
  assertEquals(unresolvedIncludes, 1);
});
