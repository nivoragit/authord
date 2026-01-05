import { ConfluenceCfg, PageId } from "../core/shared/types.ts";


function authHeader(cfg: ConfluenceCfg) {
  const token = btoa(`${cfg.basicAuth.username}:${cfg.basicAuth.password}`);
  return { Authorization: `Basic ${token}`, "Content-Type": "application/json" };
}

async function getSpaceKeyOfPage(cfg: ConfluenceCfg, parentId: PageId): Promise<string> {
  const url = new URL(`/rest/api/content/${parentId}`, cfg.baseUrl);
  url.searchParams.set("expand", "space");
  const res = await fetch(url, { headers: authHeader(cfg) });
  if (!res.ok) throw new Error(`Failed to get parent page: HTTP ${res.status}`);
  const json = await res.json();
  const key = json?.space?.key;
  if (!key) throw new Error("Parent page has no space key");
  return key;
}

async function findChildByTitle(cfg: ConfluenceCfg, parentId: PageId, title: string): Promise<PageId | null> {
  // Use CQL so we don't have to page through children.
  const url = new URL(`/rest/api/search`, cfg.baseUrl);
  url.searchParams.set("cql", `parent=${parentId} and title="${title.replaceAll('"', '\\"')}" and type=page`);
  url.searchParams.set("limit", "1");
  const res = await fetch(url, { headers: authHeader(cfg) });
  if (!res.ok) throw new Error(`CQL search failed: HTTP ${res.status}`);
  const json = await res.json();
  const hit = json?.results?.[0];
  const id = hit?.content?.id;
  return id ? (id as PageId) : null;
}

async function createChild(cfg: ConfluenceCfg, parentId: PageId, title: string, spaceKey: string): Promise<PageId> {
  const url = new URL(`/rest/api/content`, cfg.baseUrl);
  const payload = {
    type: "page",
    title,
    ancestors: [{ id: parentId }],
    space: { key: spaceKey },
    body: { storage: { value: "<p>(initial)</p>", representation: "storage" } },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: authHeader(cfg),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Failed to create child page "${title}": HTTP ${res.status} ${txt}`);
  }
  const json = await res.json();
  return json?.id as PageId;
}

export interface IChildPageResolver {
  ensureChild(parentId: PageId, title: string): Promise<PageId>;
}

export class ConfluenceChildPageResolver implements IChildPageResolver {
  constructor(private readonly cfg: ConfluenceCfg) {}
  async ensureChild(parentId: PageId, title: string): Promise<PageId> {
    const existing = await findChildByTitle(this.cfg, parentId, title);
    if (existing) return existing;
    const spaceKey = await getSpaceKeyOfPage(this.cfg, parentId);
    return await createChild(this.cfg, parentId, title, spaceKey);
  }
}
