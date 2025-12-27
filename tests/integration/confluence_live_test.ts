import { assert, assertEquals } from "std/assert";
import { asPageId, asStorageXhtml, asUrl, type ConfluenceCfg } from "../../lib/core/shared/types.ts";
import { ConfluencePageRepository, ConfluenceAttachmentRepository, ConfluencePropertyStore } from "../../lib/confluence_api/confluence_repos.ts";
import { ConfluenceSync } from "../../lib/core/application/confluence_sync.ts";
import { getPageWithVersion } from "../../lib/confluence_api/confluence_rest.ts";
import { PNG_MAGIC } from "../../lib/utils/images.ts";
import * as path from "node:path";

function safeEnvGet(name: string): string | undefined {
  try {
    const v = Deno.env.get(name);
    return v ?? undefined;
  } catch {
    return undefined;
  }
}

function parseBasicAuth(input: string): { username: string; password: string } {
  const idx = input.indexOf(":");
  if (idx <= 0) {
    throw new Error(`CONF_BASIC_AUTH must be "user:pass". Got "${input}".`);
  }
  return { username: input.slice(0, idx), password: input.slice(idx + 1) };
}

const baseUrl = safeEnvGet("CONF_BASE_URL");
const basicAuthRaw = safeEnvGet("CONF_BASIC_AUTH");
const pageIdRaw = safeEnvGet("CONF_TEST_PAGE_ID");
const liveEnabled = safeEnvGet("AUTHORD_LIVE_TEST") === "1";
const mutateEnabled = safeEnvGet("AUTHORD_LIVE_MUTATE") === "1";
const attachEnabled = safeEnvGet("AUTHORD_LIVE_ATTACH") === "1";

const live = Boolean(liveEnabled && baseUrl && basicAuthRaw && pageIdRaw);
const mutate = Boolean(live && mutateEnabled);
const attach = Boolean(mutate && attachEnabled);

const cfg: ConfluenceCfg | null = live && baseUrl && basicAuthRaw
  ? { baseUrl: asUrl(baseUrl), basicAuth: parseBasicAuth(basicAuthRaw) }
  : null;

Deno.test({
  name: "live: getPageWithVersion returns metadata",
  ignore: !live,
  fn: async () => {
    const res = await getPageWithVersion(cfg as ConfluenceCfg, pageIdRaw as string);
    assert(res, "expected page metadata");
    assertEquals(res.id, pageIdRaw);
    assert(res.nextVersion > 0);
  },
});

Deno.test({
  name: "live: ConfluenceSync updates then skips on same content",
  ignore: !mutate,
  fn: async () => {
    const pageRepo = new ConfluencePageRepository(cfg as ConfluenceCfg);
    const attachRepo = new ConfluenceAttachmentRepository(cfg as ConfluenceCfg);
    const props = new ConfluencePropertyStore(cfg as ConfluenceCfg);
    const sync = new ConfluenceSync(pageRepo, attachRepo, props);

    const meta = await pageRepo.get(asPageId(pageIdRaw as string));
    assert(meta, "expected page metadata for target page id");
    const title = meta.title || "Authord Integration Test";

    const stamp = new Date().toISOString();
    const storageHtml = asStorageXhtml(`<p>Authord live test ${stamp}</p>`);
    const page = { title, storageHtml, attachments: [] };

    const res1 = await sync.sync(page, { pageId: asPageId(pageIdRaw as string), titleOverride: title });
    assertEquals(res1.updatedBody, true);

    const res2 = await sync.sync(page, { pageId: asPageId(pageIdRaw as string), titleOverride: title });
    assertEquals(res2.updatedBody, false);
  },
});

Deno.test({
  name: "live: AttachmentRepository ensure uploads and lists attachment",
  ignore: !attach,
  fn: async () => {
    const repo = new ConfluenceAttachmentRepository(cfg as ConfluenceCfg);
    const tmpDir = await Deno.makeTempDir({ prefix: "authord-live-attach-" });
    const fileName = `authord-live-${Date.now()}.png`;
    const filePath = path.join(tmpDir, fileName);

    await Deno.writeFile(filePath, PNG_MAGIC);

    const info = await repo.ensure(asPageId(pageIdRaw as string), filePath as any, "image/png");
    assertEquals(info.fileName, fileName);

    const list = await repo.list(asPageId(pageIdRaw as string));
    const names = list.map((x) => x.fileName);
    assert(names.includes(fileName), "expected attachment in list()");

    await Deno.remove(tmpDir, { recursive: true }).catch(() => {});
  },
});
