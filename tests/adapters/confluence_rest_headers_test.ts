// tests/adapters/confluence_rest_headers_test.ts
import { assert, assertEquals, assertMatch } from "std/assert";
import {
  getPageWithVersion,
  putPageStorage,
  setRemoteHash,
  getRemoteProperty,
  listAttachments,
  findAttachmentIdByName,
} from "../../lib/adapters/confluence-rest.ts";

type HeadersLike = Record<string, string>;
type LastCall = { url: string; method: "get"|"put"|"post"; headers?: HeadersLike };

class FakeAxios {
  last: LastCall | null = null;
  // configurable responses
  responses: {
    get?: (url: string, config?: { headers?: HeadersLike }) => Promise<any>;
    put?: (url: string, data: any, config?: { headers?: HeadersLike }) => Promise<any>;
    post?: (url: string, data: any, config?: { headers?: HeadersLike }) => Promise<any>;
  } = {};

  async get(url: string, config?: { headers?: HeadersLike; params?: any }) {
    this.last = { url, method: "get", headers: config?.headers };
    if (this.responses.get) return await this.responses.get(url, config);
    return { data: {} };
    // Note: we return an object with .data like axios
  }
  async put(url: string, data: any, config?: { headers?: HeadersLike }) {
    this.last = { url, method: "put", headers: config?.headers };
    if (this.responses.put) return await this.responses.put(url, data, config);
    return { data: { id: "123", version: { number: 2 } } };
  }
  async post(url: string, data: any, config?: { headers?: HeadersLike }) {
    this.last = { url, method: "post", headers: config?.headers };
    if (this.responses.post) return await this.responses.post(url, data, config);
    return { data: {} };
  }
}

const cfg = {
  baseUrl: "https://conf.example",
  basicAuth: { username: "u", password: "p" },
} as any;

Deno.test("getPageWithVersion passes Authorization + Accept", async () => {
  const ax = new FakeAxios();
  ax.responses.get = async () => ({ data: { id: "42", title: "Hello", space: { key: "DOC" }, version: { number: 7 } } });
  const res = await getPageWithVersion(cfg, "42", ax as any);
  assert(res);
  assert(ax.last);
  const h = ax.last!.headers!;
  assertMatch(h.Authorization, /^Basic\s+/);
  assertEquals(h.Accept, "application/json");
});

Deno.test("putPageStorage uses JSON headers (Authorization + Accept + Content-Type)", async () => {
  const ax = new FakeAxios();
  // putPageStorage does not call GET internally; it just PUTs
  const out = await putPageStorage(cfg, "42", "My Title", 3, "<div/>", ax as any);
  assertEquals(out.version, 2); // from fake default
  assert(ax.last);
  const h = ax.last!.headers!;
  assertMatch(h.Authorization, /^Basic\s+/);
  assertEquals(h.Accept, "application/json");
  assertEquals(h["Content-Type"], "application/json");
});

Deno.test("setRemoteHash 'update' path uses JSON headers on GET and PUT", async () => {
  const ax = new FakeAxios();

  let getCount = 0;
  ax.responses.get = async () => {
    getCount++;
    // Existing property → expect a subsequent PUT
    return { data: { id: "prop-1", version: { number: 5 } } };
  };
  ax.responses.put = async () => ({ data: {} });

  await setRemoteHash(cfg, "42", "abc123", ax as any);

  // The last call should be PUT with proper headers
  assert(ax.last);
  assertEquals(ax.last!.method, "put");
  const h = ax.last!.headers!;
  assertMatch(h.Authorization, /^Basic\s+/);
  assertEquals(h.Accept, "application/json");
  assertEquals(h["Content-Type"], "application/json");
  assertEquals(getCount, 1);
});

Deno.test("setRemoteHash 'create' path uses JSON headers on POST", async () => {
  const ax = new FakeAxios();

  // First GET throws 404 → create via POST
  ax.responses.get = async () => {
    const err: any = new Error("not found");
    err.response = { status: 404 };
    throw err;
  };
  ax.responses.post = async () => ({ data: {} });

  await setRemoteHash(cfg, "42", "def456", ax as any);

  assert(ax.last);
  assertEquals(ax.last!.method, "post");
  const h = ax.last!.headers!;
  assertMatch(h.Authorization, /^Basic\s+/);
  assertEquals(h.Accept, "application/json");
  assertEquals(h["Content-Type"], "application/json");
});

Deno.test("listAttachments & findAttachmentIdByName pass Authorization + Accept", async () => {
  const ax = new FakeAxios();
  ax.responses.get = async (url) => {
    if (/child\/attachment/.test(url)) {
      return { data: { results: [{ title: "a.png" }, { title: "b.png" }] } };
    }
    return { data: {} };
  };
  const set = await listAttachments(cfg, "42", ax as any);
  assertEquals(Array.from(set).sort(), ["a.png", "b.png"]);
  assert(ax.last);
  let h = ax.last!.headers!;
  assertMatch(h.Authorization, /^Basic\s+/);
  assertEquals(h.Accept, "application/json");

  // find by name
  const id = await findAttachmentIdByName(cfg, "42", "a.png", ax as any);
  assertEquals(id, null); // our fake returns no id; that's fine
  assert(ax.last);
  h = ax.last!.headers!;
  assertMatch(h.Authorization, /^Basic\s+/);
  assertEquals(h.Accept, "application/json");
});
