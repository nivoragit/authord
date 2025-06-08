import { Plugin } from 'unified';
import { visit } from 'unist-util-visit';
import path from 'path';
import type { Root, Element } from 'hast';

/**
 * Rewrite every `<img src="foo.png">`
 * → `<img src="<absoluteFolder>/foo.png">`.
 *
 * Pass the **absolute** images folder on disk:
 *   { imageFolder: "/Users/.../example/images" }
 */
export function imageRootPlugin(
  opts: { imageFolder?: string }
): Plugin<[Root]> {
  const folder = opts.imageFolder;
  return (tree: Root) => {
    if (!folder) return;
    visit(tree, (node) => {
      if (node.type !== 'element') return;
      const el = node as Element;
      if (el.tagName !== 'img' || !el.properties?.src) return;
      const srcName = path.basename(String(el.properties.src));
      if (/^(https?:|data:)/i.test(srcName)) return;
      // set absolute file path in HTML
      el.properties.src = path.join(folder, srcName);
    });
  };
}
