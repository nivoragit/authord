// Confluence Server/DC REST helpers (axios-based). No hard-coded URLs.
// All URLs derive from ConfluenceCfg.baseUrl. Errors are formatted via explainAxios().

import axios, { type AxiosError, type AxiosInstance } from "axios";
import * as path from "node:path";
import { type ConfluenceCfg } from "../utils/types.ts";
import { Buffer } from "node:buffer";

export const PROP_KEY_EXPORT_HASH = "authord:exportHash";
export const PROP_KEY_ATTACH_HASHES = "authord:attachmentHashes"; // filename -> sha256 map

export function authHeaders(cfg: ConfluenceCfg): Record<string, string> {
  const creds = `${cfg.basicAuth.username}:${cfg.basicAuth.password}`;
  const token = (typeof btoa === "function")
    ? btoa(creds)
    : Buffer.from(creds).toString("base64");
  return {
    "Authorization": `Basic ${token}`,
  };
}

export function explainAxios(err: unknown, context?: string): Error {
  if (axios.isAxiosError(err)) {
    const ae = err as AxiosError<any>;
    const status = ae.response?.status;
    const statusText = ae.response?.statusText;
    const msg = (ae.response?.data?.message ||
      ae.response?.data?.errorMessage ||
      ae.message ||
      "Axios error");
    const more = status ? ` (HTTP ${status}${statusText ? " " + statusText : ""})` : "";
    return new Error(`${context ?? "HTTP error"}: ${msg}${more}`.trim());
  }

  const anyErr = err as any;
  const status = anyErr?.response?.status;
  const statusText = anyErr?.response?.statusText;
  const more = status ? ` (HTTP ${status}${statusText ? " " + statusText : ""})` : "";

  if (err instanceof Error) {
    return new Error(`${context ?? "HTTP error"}: ${err.message}${more}`.trim());
  }
  return new Error(`${context ?? "HTTP error"}: ${String(err)}${more}`.trim());
}

/** Create a preconfigured axios client for this Confluence instance. */
export function makeClient(cfg: ConfluenceCfg, ax?: AxiosInstance): AxiosInstance {
  if (ax) return ax;
  return axios.create({
    baseURL: cfg.baseUrl as unknown as string,
    headers: {
      ...authHeaders(cfg),
      "Accept": "application/json",
    },
  });
}

/** Get page, returning current metadata and the *next* version number to use. */
export async function getPageWithVersion(
  cfg: ConfluenceCfg,
  pageId: string,
  ax?: AxiosInstance,
): Promise<{ id: string; title: string; spaceKey: string; nextVersion: number } | null> {
  const client = makeClient(cfg, ax);
  try {
    const res = await client.get(`/rest/api/content/${encodeURIComponent(pageId)}`, {
      params: { expand: "version,space" },
    });
    const body = res.data ?? {};
    const current = Number(body?.version?.number ?? 0) || 0;
    const title = String(body?.title ?? "");
    const spaceKey = String(body?.space?.key ?? "");
    return { id: String(body?.id ?? pageId), title, spaceKey, nextVersion: current + 1 };
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) return null;
    if ((err as any)?.response?.status === 404) return null;
    throw explainAxios(err, "Failed to get page");
  }
}

/** Update page storage body; caller must supply the next version number. */
export async function putPageStorage(
  cfg: ConfluenceCfg,
  pageId: string,
  title: string,
  nextVersion: number,
  storageHtml: string,
  ax?: AxiosInstance,
): Promise<{ id: string; version: number }> {
  const client = makeClient(cfg, ax);
  try {
    const res = await client.put(`/rest/api/content/${encodeURIComponent(pageId)}`, {
      id: pageId,
      type: "page",
      title,
      version: { number: nextVersion },
      body: {
        storage: {
          value: storageHtml,
          representation: "storage",
        },
      },
    }, {
      headers: { "Content-Type": "application/json" },
    });
    const data = res.data ?? {};
    return { id: String(data?.id ?? pageId), version: Number(data?.version?.number ?? nextVersion) };
  } catch (err) {
    throw explainAxios(err, "Failed to update page body");
  }
}

/** Read a content property; return null if 400/404 (missing or not set). */
export async function getRemoteProperty(
  cfg: ConfluenceCfg,
  pageId: string,
  key: string,
  ax?: AxiosInstance,
): Promise<any | null> {
  const client = makeClient(cfg, ax);
  try {
    const res = await client.get(`/rest/api/content/${encodeURIComponent(pageId)}/property/${encodeURIComponent(key)}`);
    return res.data;
  } catch (err) {
    const status = axios.isAxiosError(err) ? err.response?.status : (err as any)?.response?.status;
    if (status === 400 || status === 404) return null;
    throw explainAxios(err, `Failed to read content property "${key}"`);
  }
}

/** Convenience to fetch the export hash property string or null. */
export async function getRemoteHash(
  cfg: ConfluenceCfg,
  pageId: string,
  ax?: AxiosInstance,
): Promise<string | null> {
  const data = await getRemoteProperty(cfg, pageId, PROP_KEY_EXPORT_HASH, ax);
  const value = data?.value ?? data?.results?.[0]?.value;
  return typeof value === "string" ? value : null;
}

/** ---- DC-safe upsert for content properties (PUT requires id + version bump) ---- */

async function upsertContentPropertyWithVersion(
  cfg: ConfluenceCfg,
  pageId: string,
  key: string,
  value: any,
  ax?: AxiosInstance,
): Promise<void> {
  const client = makeClient(cfg, ax);

  // 1) Try read to get id + version
  try {
    const getRes = await client.get(
      `/rest/api/content/${encodeURIComponent(pageId)}/property/${encodeURIComponent(key)}`
    );
    const prop = getRes.data ?? {};
    const propId = String(prop?.id ?? "");
    const currentVer = Number(prop?.version?.number ?? 0);
    const body: any = {
      id: propId || undefined,
      key,
      value,
      version: { number: currentVer + 1 },
    };

    await client.put(
      `/rest/api/content/${encodeURIComponent(pageId)}/property/${encodeURIComponent(key)}`,
      body,
      { headers: { "Content-Type": "application/json" } }
    );
    return;
  } catch (err) {
    const status = (axios.isAxiosError(err) ? err.response?.status : (err as any)?.response?.status) ?? 0;
    if (status !== 404) {
      throw explainAxios(err, `Failed to read content property "${key}"`);
    }
  }

  // 2) Not found -> create
  try {
    await client.post(
      `/rest/api/content/${encodeURIComponent(pageId)}/property`,
      { key, value },
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    throw explainAxios(err, `Failed to create content property "${key}"`);
  }
}

/** Set/replace the export hash content property (DC-safe). */
export async function setRemoteHash(
  cfg: ConfluenceCfg,
  pageId: string,
  hash: string,
  ax?: AxiosInstance,
): Promise<void> {
  await upsertContentPropertyWithVersion(cfg, pageId, PROP_KEY_EXPORT_HASH, hash, ax);
}

/** ---- Attachment hash manifest (filename -> sha256) ------------------ */

async function sha256HexOfBytes(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  const b = new Uint8Array(buf);
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function getAttachmentHashes(
  cfg: ConfluenceCfg,
  pageId: string,
  ax?: AxiosInstance,
): Promise<Record<string, string>> {
  const data = await getRemoteProperty(cfg, pageId, PROP_KEY_ATTACH_HASHES, ax);
  const raw = data?.value ?? data?.results?.[0]?.value;
  if (!raw) return {};
  if (typeof raw === "string") {
    try { return JSON.parse(raw) as Record<string, string>; } catch { return {}; }
  }
  if (typeof raw === "object") return raw as Record<string, string>;
  return {};
}

export async function setAttachmentHashes(
  cfg: ConfluenceCfg,
  pageId: string,
  map: Record<string, string>,
  ax?: AxiosInstance,
): Promise<void> {
  await upsertContentPropertyWithVersion(cfg, pageId, PROP_KEY_ATTACH_HASHES, map, ax);
}

/** List attachment filenames for the page (Set for quick lookup). */
export async function listAttachments(
  cfg: ConfluenceCfg,
  pageId: string,
  ax?: AxiosInstance,
): Promise<Set<string>> {
  const client = makeClient(cfg, ax);
  try {
    const out = new Set<string>();
    let start = 0;
    const limit = 200;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const res = await client.get(`/rest/api/content/${encodeURIComponent(pageId)}/child/attachment`, {
        params: { limit, start },
      });
      const results: any[] = res.data?.results ?? [];
      for (const r of results) {
        const fname = String(r?.title ?? r?.metadata?.mediaType?.fileName ?? r?.metadata?.comment ?? "");
        if (fname) out.add(fname);
      }
      if (results.length < limit) break;
      start += limit;
    }
    return out;
  } catch (err) {
    throw explainAxios(err, "Failed to list attachments");
  }
}

/** Find an attachment by filename; return its id or null. */
export async function findAttachmentIdByName(
  cfg: ConfluenceCfg,
  pageId: string,
  filename: string,
  ax?: AxiosInstance,
): Promise<string | null> {
  const client = makeClient(cfg, ax);
  try {
    const res = await client.get(`/rest/api/content/${encodeURIComponent(pageId)}/child/attachment`, {
      params: { filename, limit: 50 },
    });
    const results: any[] = res.data?.results ?? [];
    const item = results.find((x) => String(x?.title) === filename);
    return item?.id ? String(item.id) : null;
  } catch (err) {
    throw explainAxios(err, "Failed to query attachment by filename");
  }
}

/** Upload a PNG file as a new attachment. Returns filename. */
export async function uploadImage(
  cfg: ConfluenceCfg,
  pageId: string,
  absPngPath: string,
  ax?: AxiosInstance,
): Promise<string> {
  const client = makeClient(cfg, ax);
  const FormData = (await import("form-data")).default as any;
  const fd = new FormData();
  const data = await Deno.readFile(absPngPath);
  const filename = path.basename(absPngPath);
  // Node FormData accepts Buffer
  // deno-lint-ignore no-explicit-any
  const buf: any = (typeof Buffer !== "undefined")
    ? Buffer.from(data)
    : data;
  fd.append("file", buf, {
    filename,
    contentType: "image/png",
  });
  try {
    await client.post(`/rest/api/content/${encodeURIComponent(pageId)}/child/attachment`, fd, {
      headers: {
        ...fd.getHeaders?.(),
        ...authHeaders(cfg),
        "X-Atlassian-Token": "no-check",
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    return filename;
  } catch (err) {
    throw explainAxios(err, `Failed to upload attachment "${filename}"`);
  }
}

/** Update existing attachment data by id. */
export async function updateAttachmentData(
  cfg: ConfluenceCfg,
  pageId: string,
  attachmentId: string,
  absPngPath: string,
  ax?: AxiosInstance,
): Promise<string> {
  const client = makeClient(cfg, ax);
  const FormData = (await import("form-data")).default as any;
  const fd = new FormData();
  const data = await Deno.readFile(absPngPath);
  const filename = path.basename(absPngPath);
  // deno-lint-ignore no-explicit-any
  const buf: any = (typeof Buffer !== "undefined")
    ? Buffer.from(data)
    : data;
  fd.append("file", buf, {
    filename,
    contentType: "image/png",
  });
  try {
    await client.put(`/rest/api/content/${encodeURIComponent(pageId)}/child/attachment/${encodeURIComponent(attachmentId)}/data`, fd, {
      headers: {
        ...fd.getHeaders?.(),
        ...authHeaders(cfg),
        "X-Atlassian-Token": "no-check",
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    return filename;
  } catch (err) {
    throw explainAxios(err, `Failed to update attachment "${filename}"`);
  }
}

/**
 * Ensure the attachment with the given filename exists with up-to-date bytes.
 * Compares the local file's SHA-256 to a page-scoped manifest (content property).
 * If unchanged, no upload occurs. After any upload/update, the manifest is updated.
 */
export async function ensureAttachment(
  cfg: ConfluenceCfg,
  pageId: string,
  absPngPath: string,
  ax?: AxiosInstance,
): Promise<string> {
  const filename = path.basename(absPngPath);
  const client = makeClient(cfg, ax);

  // Compute local hash
  const localBytes = await Deno.readFile(absPngPath);
  const localSha = await sha256HexOfBytes(localBytes);

  // Load/update manifest
  const manifest = await getAttachmentHashes(cfg, pageId, client);
  const prevSha = manifest[filename];

  // If identical, skip network
  if (prevSha && prevSha === localSha) {
    return filename;
  }

  // Find by filename
  const existingId = await findAttachmentIdByName(cfg, pageId, filename, client);

  if (existingId) {
    await updateAttachmentData(cfg, pageId, existingId, absPngPath, client);
  } else {
    // Try create
    try {
      await uploadImage(cfg, pageId, absPngPath, client);
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : (err as any)?.response?.status;
      if (status === 409 || status === 400) {
        const again = await findAttachmentIdByName(cfg, pageId, filename, client);
        if (again) {
          await updateAttachmentData(cfg, pageId, again, absPngPath, client);
        } else {
          throw err instanceof Error ? err : explainAxios(err, "ensureAttachment failed");
        }
      } else {
        throw err instanceof Error ? err : explainAxios(err, "ensureAttachment failed");
      }
    }
  }

  // Write new hash to manifest
  manifest[filename] = localSha;
  await setAttachmentHashes(cfg, pageId, manifest, client);

  return filename;
}
