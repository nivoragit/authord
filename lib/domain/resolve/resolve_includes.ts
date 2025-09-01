import { TopicBlockNode, TopicPageNode } from "../model/ast.ts";

export type LookupTopic = (relativeTo: string, path: string) => TopicPageNode | undefined;

export function resolveIncludes(
  page: TopicPageNode,
  lookupTopic: LookupTopic,
) {
  const stack: string[] = []; // normalized cycle keys "<targetFile>#<elementId>"

  function visit(parent: { children: TopicBlockNode[] }, ownerFile: string) {
    for (let i = 0; i < parent.children.length; i++) {
      const node = parent.children[i];

      if (node.type === "includeMarker") {
        handleIncludeAt(parent, i, ownerFile);
        continue;
      }

      if ((node as any).children?.length) {
        visit(node as any, ownerFile);
      }
    }
  }

  function handleIncludeAt(parent: { children: TopicBlockNode[] }, idx: number, ownerFile: string) {
    const marker = parent.children[idx];
    if (marker.type !== "includeMarker") return;

    const fromRel = marker.data.from;
    const elemId = marker.data.elementId;

    const target = lookupTopic(ownerFile, fromRel);
    if (!target) {
      parent.children.splice(idx, 1);
      return;
    }

    const key = `${target.data.file}#${elemId}`;
    if (stack.includes(key)) {
      throw new Error(`Include cycle: ${[...stack, key].join(" => ")}`);
    }

    stack.push(key);

    const found = findById(target.children, elemId);
    if (!found) {
      parent.children.splice(idx, 1);
      stack.pop();
      return;
    }

    const replacement = (found.type === "chapter" || found.type === "snippetDef")
      ? deepClone(found.children)
      : [deepClone(found)];

    parent.children.splice(idx, 1, ...replacement);

    // process inserted slice immediately while key is still on the stack
    const start = idx;
    const end = idx + replacement.length;
    processRange(parent, start, end, target.data.file);

    stack.pop();
  }

  function processRange(
    parent: { children: TopicBlockNode[] },
    start: number,
    end: number,
    ownerFile: string,
  ) {
    let i = start;
    while (i < end) {
      const node = parent.children[i];
      if (node.type === "includeMarker") {
        handleIncludeAt(parent, i, ownerFile);
        continue; // re-check current index after splice
      }
      if ((node as any).children?.length) {
        visit(node as any, ownerFile);
      }
      i++;
    }
  }

  visit(page, page.data.file);
}

function findById(nodes: TopicBlockNode[], id: string): TopicBlockNode | undefined {
  for (const n of nodes) {
    if (n.type === "chapter" && (n as any).data.id === id) return n;
    if (n.type === "snippetDef" && (n as any).data.id === id) return n;
    if ((n as any).children?.length) {
      const hit = findById((n as any).children, id);
      if (hit) return hit;
    }
  }
  return undefined;
}

const deepClone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
