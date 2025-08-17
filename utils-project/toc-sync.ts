// File: src/utils/toc-sync.ts
import { promises as fs } from 'fs';
import { XMLParser } from 'fast-xml-parser';
import { TocConfig, TreeNode } from './types';

/**
 * Read an .tree file and extract:
 *  - rootTitle  (instance-profile @name)
 *  - startPage  (instance-profile @start-page)
 *  - nodes      (nested toc-element → TreeNode[])
 */
export async function parseTreeConfig(xmlPath: string): Promise<TocConfig> {
  const xml    = await fs.readFile(xmlPath, 'utf8');
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
  const json   = parser.parse(xml);
  const ip     = json['instance-profile'];

  const rootTitle = ip.name as string;
  const startPage = ip['start-page'] as string;

  const tocArr = ip['toc-element'] ?? [];
  const rawArr = Array.isArray(tocArr) ? tocArr : [tocArr];
  const nodes  = buildTree(rawArr, null);

  return { rootTitle, startPage, nodes };
}

function buildTree(elArr: any[], parent: TreeNode | null): TreeNode[] {
  return elArr.map((el, i) => {
    const node: TreeNode = {
      file:     el.topic as string,
      index:    i,
      parent,
      children: []
    };
    const kids = el['toc-element'] ?? [];
    node.children = buildTree(
      Array.isArray(kids) ? kids : [kids],
      node
    );
    return node;
  });
}

/** Depth-first pre-order flattening. */
export function flatten(nodes: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  function visit(n: TreeNode) {
    out.push(n);
    n.children.forEach(visit);
  }
  nodes.forEach(visit);
  return out;
}

/** Helper to get the parent filename or null */
export function parentKey(node: TreeNode): string | null {
  return node.parent ? node.parent.file : null;
}
