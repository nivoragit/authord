// Tests for Confluence adapters using a mocked AxiosInstance (no network).

import {
  ConfluencePageRepository,
  ConfluenceAttachmentRepository,
  ConfluencePropertyStore,
} from "../lib/adapters/confluence-repos.ts";
import type { ConfluenceCfg } from "../lib/utils/types.ts";
import type { AxiosInstance } from "axios";
import { makeExportHash } from "../lib/domain/entities.ts";

function makeCfg(): ConfluenceCfg {
  return {
    baseUrl: "https://conf.example.test" as any,
    basicAuth: { username: "u", password: "p" },
  };
}

function createMockAxios(handlers: {
  get?: (
    url: string,
    config?: any,
  ) => Promise<{ status: number; data: any }>;
  put?: (
    url: string,
    data?: any,
    config?: any,
  ) => Promise<{ status: number; data: any }>;
  post?: (
    url: string,
    data?: any,
    config?: any,
  ) => Promise<{ status: number; data: any }>;
} = {}): AxiosInstance {
  return {
    get: async (url: string, config?: any) =>
      handlers.get
        ? handlers.get(url, config)
        : Promise.resolve({ status: 404, data: {} }),
    put: async (url: string, data?: any, config?: any) =>
      handlers.put
        ? handlers.put(url, data, config)
        : Promise.resolve({ status: 200, data: {} }),
    post: async (url: string, data?: any, config?: any) =>
      handlers.post
        ? handlers.post(url, data, config)
        : Promise.resolve({ status: 200, data: {} }),
    // Minimal mock; other AxiosInstance members are unused.
  } as unknown as AxiosInstance;
}

Deno.test("PageRepository.get returns current version and title", async () => {
  const cfg = makeCfg();
  const ax = createMockAxios({
    get: async (url, _config) => {
      if (url.startsWith("/rest/api/content/")) {
        return {
          status: 200,
          data: {
            id: "123",
            title: "Hello",
            space: { key: "SP" },
            version: { number: 7 },
          },
        };
      }
      return { status: 404, data: {} };
    },
  });

  const repo = new ConfluencePageRepository(cfg, ax);
  const res = await repo.get("123" as any);
  if (!res) throw new Error("Expected page metadata");
  if (res.version !== 7) {
    throw new Error(`Expected version 7, got ${res.version}`);
  }
  if (res.title !== "Hello") throw new Error("Title mismatch");
});

Deno.test(
  "PageRepository.putStorageBody increments version and returns new version",
  async () => {
    const cfg = makeCfg();
    let putBody: any = null;

    const ax = createMockAxios({
      get: async (_url, _config) => ({
        status: 200,
        data: {
          id: "123",
          title: "Hello",
          space: { key: "SP" },
          version: { number: 3 },
        },
      }),
      put: async (_url, data, _config) => {
        putBody = data;
        return {
          status: 200,
          data: { id: "123", version: { number: data.version.number } },
        };
      },
    });

    const repo = new ConfluencePageRepository(cfg, ax);
    const res = await repo.putStorageBody(
      "123" as any,
      "<p>x</p>" as any,
      "New Title",
    );
    if (res.version !== 4) {
      throw new Error(`Expected new version 4, got ${res.version}`);
    }
    if (putBody.title !== "New Title") throw new Error("Title not used");
    if (putBody.body.storage.value !== "<p>x</p>") {
      throw new Error("Storage body mismatch");
    }
  },
);

Deno.test("PropertyStore get/set roundtrip (branded ExportHash)", async () => {
  const cfg = makeCfg();
  let lastPut: any = null;
  let hasProp = false;

  const ax = createMockAxios({
    get: async (url) => {
      if (url.endsWith("/property/authord%3AexportHash")) {
        if (!hasProp) {
          const e = new Error("not found") as any;
          e.response = { status: 404 };
        // deno-lint-ignore no-unsafe-finally
          throw e;
        }
        return {
          status: 200,
          data: { key: "authord:exportHash", value: "deadbeef" },
        };
      }
      return { status: 404, data: {} };
    },
    put: async (url, _data) => {
      if (url.endsWith("/property/authord%3AexportHash")) {
        const e = new Error("not found") as any;
        e.response = { status: 404 };
        // deno-lint-ignore no-unsafe-finally
        throw e;
      }
      return { status: 200, data: {} };
    },
    post: async (url, data) => {
      if (url.endsWith("/property")) {
        lastPut = data;
        hasProp = true;
        return {
          status: 200,
          data: { key: "authord:exportHash", value: data.value },
        };
      }
      return { status: 200, data: {} };
    },
  });

  const store = new ConfluencePropertyStore(cfg, ax);
  const v0 = await store.getExportHash("321" as any);
  if (v0 !== null) throw new Error("Expected null for missing property");

  await store.setExportHash("321" as any, makeExportHash("deadbeef"));
  if (lastPut?.value !== "deadbeef") throw new Error("Property not set");

  const vv = await store.getExportHash("321" as any);
  if (!vv || String(vv) !== "deadbeef") {
    throw new Error("Unexpected property value");
  }
});

Deno.test(
  "AttachmentRepository list and ensure (create then update)",
  async () => {
    const cfg = makeCfg();
    const uploaded: string[] = [];
    let existingId: string | null = null;

    const ax = createMockAxios({
      get: async (url, config) => {
        if (url.includes("/child/attachment") && config?.params?.limit) {
          // list
          return {
            status: 200,
            data: {
              results: uploaded.map((fn, i) => ({ id: String(i + 1), title: fn })),
            },
          };
        }
        if (url.includes("/child/attachment") && config?.params?.filename) {
          // query by filename
          const fn = config.params.filename;
          const idx = uploaded.indexOf(fn);
          if (idx >= 0) {
            existingId = String(idx + 1);
            return {
              status: 200,
              data: { results: [{ id: existingId, title: fn }] },
            };
          }
          return { status: 200, data: { results: [] } };
        }
        return { status: 404, data: {} };
      },
      post: async (url, _data, _config) => {
        if (url.includes("/child/attachment")) {
          // Simulate initial create
          uploaded.push("pic.png");
          return { status: 200, data: {} };
        }
        return { status: 200, data: {} };
      },
      put: async (url, _data, _config) => {
        if (url.includes("/child/attachment/") && url.endsWith("/data")) {
          // Simulate update
          return { status: 200, data: {} };
        }
        return { status: 200, data: {} };
      },
    });

    const repo = new ConfluenceAttachmentRepository(cfg, ax);

    // Initially empty
    const l0 = await repo.list("123" as any);
    if (l0.length !== 0) throw new Error("Expected no attachments initially");

    // Ensure creates
    const tmpDir = await Deno.makeTempDir({ prefix: "authord-attach-" });
    const file = `${tmpDir}/pic.png`;
    await Deno.writeFile(
      file,
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    const a1 = await repo.ensure("123" as any, file as any);
    if (a1.fileName !== "pic.png") {
      throw new Error("Attachment filename mismatch after ensure");
    }

    const l1 = await repo.list("123" as any);
    if (l1.length !== 1 || l1[0].fileName !== "pic.png") {
      throw new Error("List after upload failed");
    }

    // Ensure update path (same file again triggers update)
    const a2 = await repo.ensure("123" as any, file as any);
    if (a2.fileName !== "pic.png") {
      throw new Error("Attachment filename mismatch on update");
    }

    await Deno.remove(tmpDir, { recursive: true }).catch(() => {});
  },
);
