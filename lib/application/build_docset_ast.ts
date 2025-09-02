// src/application/build_docset_ast.ts
import type { IRConfig, IRInstance, IRTocItem } from "../domain/model/ir.ts";
import { DocsetRoot, InstancesNode, InstanceNode, TocNode, PagesNode, TopicPageNode, MarkdownPageNode, TopicBlockNode } from "../domain/model/ast.ts";
import { expandMacros } from "../domain/macros/expand_macros.ts";
import { parseCfg } from "../domain/parse/parse_cfg.ts";
import { parseTree } from "../domain/parse/parse_tree.ts";
import { parseTopic } from "../domain/parse/parse_topic.ts";
import { parseMarkdown } from "../domain/parse/parse_markdown.ts";
import { resolveIncludes } from "../domain/resolve/resolve_includes.ts";
import { resolveCodeBlocks } from "../domain/resolve/resolve_code_blocks.ts";

export type Resource = {
  readText: (pathOrUrl: string) => Promise<string>;
  resolve: (base: string, target: string) => string;
  exists: (pathOrUrl: string) => Promise<boolean>;
};

export type BuildOptions = {
  cfgPath: string;
  resource: Resource;
  macros?: Record<string,string>;
  fetchExternalCode?: boolean;
};

export async function buildDocsetAst({ cfgPath, resource, macros = {}, fetchExternalCode = true }: BuildOptions) {
  // 1) config
  const cfgRaw = await resource.readText(cfgPath);
  const cfg = parseCfg(expandMacros(cfgRaw, macros));


  // 2) instances
  const instances: { ir: IRInstance; webPath?: string; srcAbs: string }[] = [];
  for (const inst of cfg.instances) {
    const abs = resource.resolve(cfgPath, inst.src);
    const txt = expandMacros(await resource.readText(abs), macros);
    instances.push({ ir: parseTree(txt), webPath: inst.webPath, srcAbs: abs });
  }
 

  // 3) gather content
const topics = new Set<string>();
const mds    = new Set<string>();
const topicsBase = resource.resolve(cfgPath, cfg.topicsDir);
for (const { ir } of instances) walk(ir.toc, (n) => {
  // if (n.topic) topics.add(resource.resolve(topicsBase, n.topic));

  if (n.topic) {
    if (n.topic.toLowerCase().endsWith(".topic")) {
      topics.add(resource.resolve(topicsBase, n.topic));
    } else if (n.topic.toLowerCase().endsWith(".md")) {
      mds.add(resource.resolve(topicsBase, n.topic));
    }
  }

  // if (n.file)  mds.add(resource.resolve(topicsBase, n.file)); // todo
});


  // 4) parse topics
  const topicMap = new Map<string, TopicPageNode>();
  for (const p of topics) {
    const xml = expandMacros(await resource.readText(p), macros);
    topicMap.set(p, parseTopic(xml, p));
  }
  
  // === PRELOAD INCLUDE TARGETS (transitive closure) ===
  const queue: TopicPageNode[] = [...topicMap.values()];
  const seen = new Set<string>([...topicMap.keys()]);

  while (queue.length) {
    const page = queue.pop()!;
    // find include markers in this page
    const targets: string[] = [];
    (function walk(node: any) {
        if (!node) return;
        if (node.type === "includeMarker") {
        const abs = resource.resolve(page.data.file, node.data.from);
        targets.push(abs);
        }
        if (node.children) node.children.forEach(walk);
    })(page);

    for (const abs of targets) {
        if (seen.has(abs)) continue;
        if (!(await resource.exists(abs))) {
        console.debug("[build] preload: missing on disk", abs);
        continue;
        }
        console.debug("[build] preload: parse", abs);
        const xml = expandMacros(await resource.readText(abs), macros);
        const t = parseTopic(xml, abs);
        topicMap.set(abs, t);
        queue.push(t);
        seen.add(abs);
    }
 }


  // 5) parse md
  const mdMap = new Map<string, MarkdownPageNode>();
  for (const m of mds) mdMap.set(m, parseMarkdown(await resource.readText(m), m));

  // 6) includes
  for (const [path, page] of topicMap) {
    resolveIncludes(page, (_rel, from) => {
      const abs = resource.resolve(path, from);
      return topicMap.get(abs);
    });
  }

  // 7) code blocks
  if (fetchExternalCode) {
    const snippetsBase = resource.resolve(cfgPath, cfg.snippetsDir);
    for (const [_path, page] of topicMap) {
      await resolveCodeBlocks(page, async (src) => {
        if (/^https?:\/\//i.test(src)) {
        console.debug(`[build] code block: skip external url ${src}`);
        return "";
       }
        const abs = resource.resolve(snippetsBase, src);
        return await resource.readText(abs);
      });
    }
  }

  // 8) assemble UNIST
  const instancesNode: InstancesNode = {
    type: "instances",
    children: instances.map(({ ir, webPath }) => toInstance(ir, webPath)),
  };
  const pagesNode: PagesNode = { type: "pages", children: [...topicMap.values(), ...mdMap.values()] };

  const root: DocsetRoot = {
    type: "docset",
    data: { topicsDir: cfg.topicsDir, imagesDir: cfg.imagesDir },
    children: [instancesNode, pagesNode],
  };
  return root;
}



function toInstance(ir: IRInstance, webPath?: string): InstanceNode {
  return {
    type: "instance",
    data: { id: ir.id, name: ir.name, startPage: ir.startPage, isLibrary: ir.isLibrary, webPath },
    children: toToc(ir.toc),
  };
}

function toToc(items: IRTocItem[]): TocNode[] {
  return items.map((i) => ({
    type: "toc",
    data: { title: i.title, topic: i.topic, file: i.file },
    children: toToc(i.children ?? []),
  }));
}

function collectIncludeTargets(page: TopicPageNode): string[] {
  const out: string[] = [];
  function walk(nodes: TopicBlockNode[]) {
    for (const n of nodes) {
      if (n.type === "includeMarker") out.push(n.data.from);
      // @ts-ignore - children exist on composite nodes
      if ((n as any).children?.length) walk((n as any).children);
    }
  }
  walk(page.children);
  return out;
}

function walk(items: IRTocItem[], visit: (n: IRTocItem) => void) {
  for (const n of items) { visit(n); if (n.children?.length) walk(n.children, visit); }
}
