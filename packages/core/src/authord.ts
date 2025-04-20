import TreeModel from 'tree-model';
import {InstanceProfile, Product, TocElement} from "./types";

/**
 * Abstract Product implementation using tree-model
 */
export abstract class AbstractProduct<
  TE extends TocElement,
  IP extends InstanceProfile<TE>
> implements Product<TE, IP> {
  version: string;
  workspaceDir: string;
  topicsDir: string;
  imagesDir: string;
  instanceProfiles: Map<string, IP>;

  constructor(
    version: string,
    workspaceDir: string,
    topicsDir: string,
    imagesDir: string
  ) {
    this.version = version;
    this.workspaceDir = workspaceDir;
    this.topicsDir = topicsDir;
    this.imagesDir = imagesDir;
    this.instanceProfiles = new Map<string, IP>();
  }

  addInstance(instance: IP): void {
    this.instanceProfiles.set(instance.id, instance);
  }

  getInstances(): IP[] {
    return Array.from(this.instanceProfiles.values());
  }

  getInstanceById(id: string): IP | undefined {
    return this.instanceProfiles.get(id);
  }
}

/**
 * Abstract InstanceProfile implementation using tree‑model.
 */
export abstract class AbstractInstanceProfile<TE extends TocElement>
  implements InstanceProfile<TE> {

  id: string;
  name: string;
  startPage: string;
  version: string;

  private readonly tree: TreeModel.Node<TE>;
  private readonly treeModel: TreeModel;

  constructor(
    id: string,
    name: string,
    startPage: string,
    tocElements: TE[],
    version: string
  ) {
    this.id = id;
    this.name = name;
    this.startPage = startPage;
    this.version = version;

    this.treeModel = new TreeModel({
      childrenPropertyName: 'children',
      modelComparatorFn: (a: TE, b: TE) => a === b
    });

    this.tree = this.treeModel.parse({} as TE);          // hidden root

    tocElements.forEach(el => {
      this.setParentReferences(el);                      // ensure parent links
      const node = this.treeModel.parse(el);
      this.tree.addChild(node);
    });
  }

  /** Root‑level immutable TOC elements */
  get tocElements(): TE[] {
    return this.tree.children.map((n: { model: any; }) => n.model);
  }

  /** Add a new TOC element under `parentElement` (root if omitted) */
  addTocElement(element: TE, parentElement?: TE): void {
    this.setParentReferences(element, parentElement);
    const newNode = this.treeModel.parse(element);

    const parentNode =
      parentElement
        ? this.tree.first(n => n.model === parentElement) || this.tree
        : this.tree;

    parentNode.addChild(newNode);
  }

  /** Remove a topic (and its subtree) */
  removeTopic(element: TE): void {
    const node = this.tree.first(n => n.model === element);
    if (node && node !== this.tree) node.drop();
  }

  /**
   * Replace `oldElement` with `newElement`.
   * ‑ Same parent  ⇒ replace in place.
   * ‑ Different parent (via `newElement.parent`) ⇒ move.
   * ‑ Children of the old element are preserved.
   */
  replace(oldElement: TE, newElement: TE): void {
    const oldNode = this.tree.first(n => n.model === oldElement);
    if (!oldNode || oldNode === this.tree) return;

    const oldParentNode = oldNode.parent ?? this.tree;
    const oldIndex = oldNode.getIndex();

    // determine target parent
    const targetParentNode =
      newElement.parent
        ? this.tree.first(n => n.model === newElement.parent) || this.tree
        : oldParentNode;

    // capture children, drop old node
    const oldChildren = oldNode.children.slice();
    oldNode.drop();

    // build new node, attach
    this.setParentReferences(newElement, newElement.parent);
    const newNode = this.treeModel.parse(newElement);

    (targetParentNode === oldParentNode)
      ? targetParentNode.addChildAtIndex(newNode, oldIndex)   // replace
      : targetParentNode.addChild(newNode);                   // move

    // re‑attach children and update their parent refs
    newNode.addChildren(oldChildren);
    oldChildren.forEach((child: { model: TE; }) => this.setParentReferences(child.model, newElement));
  }

  /** Recursively sets correct `parent` references on TOC elements */
  private setParentReferences(el: TE, parent?: TE): void {
    el.parent = parent;
    (el.children ?? []).forEach(child => this.setParentReferences(child as TE, el));
  }
}
