import { assertEquals, assertRejects } from "std/assert";
import { makeLocalFirstCachingFetcher } from "@authord/render-core/utils/schema_fetcher.ts";

async function withDenoOverrides<T>(
  overrides: Record<string, unknown>,
  fn: () => Promise<T> | T,
): Promise<T> {
  const original: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(overrides)) {
    original[key] = (Deno as any)[key];
    (Deno as any)[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      (Deno as any)[key] = value;
    }
  }
}

async function withFetchOverride<T>(
  impl: typeof fetch,
  fn: () => Promise<T> | T,
): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

Deno.test("schema_fetcher: reads file:// URLs via readTextFile", async () => {
  let readPath = "";
  await withDenoOverrides(
    {
      readTextFile: async (p: string) => {
        readPath = p;
        return "FILE";
      },
    },
    async () => {
      const fetcher = makeLocalFirstCachingFetcher({ cacheMap: {}, allowNetwork: false });
      const out = await fetcher("file:///tmp/schema.xsd");
      assertEquals(out, "FILE");
      assertEquals(readPath, "/tmp/schema.xsd");
    },
  );
});

Deno.test("schema_fetcher: uses local cache when present", async () => {
  const url = "https://example.com/schema.xsd";
  const local = "cache/schema.xsd";
  await withDenoOverrides(
    {
      stat: async (p: string) => {
        if (p === local) return { isFile: true };
        throw new Error("ENOENT");
      },
      readTextFile: async (p: string) => (p === local ? "LOCAL" : ""),
    },
    async () => {
      await withFetchOverride(
        async () => {
          throw new Error("fetch should not be called");
        },
        async () => {
          const fetcher = makeLocalFirstCachingFetcher({ cacheMap: { [url]: local } });
          const out = await fetcher(url);
          assertEquals(out, "LOCAL");
        },
      );
    },
  );
});

Deno.test("schema_fetcher: missing cache + allowNetwork=false throws", async () => {
  const url = "https://example.com/schema.xsd";
  const local = "cache/schema.xsd";
  await withDenoOverrides(
    {
      stat: async () => {
        throw new Error("ENOENT");
      },
    },
    async () => {
      const fetcher = makeLocalFirstCachingFetcher({
        cacheMap: { [url]: local },
        allowNetwork: false,
      });
      await assertRejects(
        () => fetcher(url),
        Error,
        "network disabled",
      );
    },
  );
});

Deno.test("schema_fetcher: missing cache + allowNetwork=true fetches and writes", async () => {
  const url = "https://example.com/schema.xsd";
  const local = "cache/schema.xsd";
  let wrotePath = "";
  let wroteText = "";
  let mkdirPath = "";

  await withDenoOverrides(
    {
      stat: async () => {
        throw new Error("ENOENT");
      },
      writeTextFile: async (p: string, text: string) => {
        wrotePath = p;
        wroteText = text;
      },
      mkdir: async (p: string) => {
        mkdirPath = p;
      },
    },
    async () => {
      await withFetchOverride(
        async () => new Response("REMOTE", { status: 200 }),
        async () => {
          const fetcher = makeLocalFirstCachingFetcher({
            cacheMap: { [url]: local },
            allowNetwork: true,
          });
          const out = await fetcher(url);
          assertEquals(out, "REMOTE");
          assertEquals(wrotePath, local);
          assertEquals(wroteText, "REMOTE");
          assertEquals(mkdirPath, "cache");
        },
      );
    },
  );
});

Deno.test("schema_fetcher: unmapped + allowNetwork=false throws", async () => {
  const fetcher = makeLocalFirstCachingFetcher({ cacheMap: {}, allowNetwork: false });
  await assertRejects(
    () => fetcher("https://example.com/unmapped.xsd"),
    Error,
    "network disabled",
  );
});

Deno.test("schema_fetcher: unmapped + allowNetwork=true fetches", async () => {
  await withFetchOverride(
    async () => new Response("REMOTE2", { status: 200 }),
    async () => {
      const fetcher = makeLocalFirstCachingFetcher({ cacheMap: {}, allowNetwork: true });
      const out = await fetcher("https://example.com/unmapped.xsd");
      assertEquals(out, "REMOTE2");
    },
  );
});
