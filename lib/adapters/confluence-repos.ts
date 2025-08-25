// Confluence adapters implementing ports using axios and the REST helpers.

import type {
  IPageRepository,
  IAttachmentRepository,
  IPropertyStore,
  AttachmentInfo,
} from "../ports/ports.ts";
import type {
  ConfluenceCfg,
  PageId,
  Path,
  StorageXhtml,
} from "../utils/types.ts";
import axios, { type AxiosInstance } from "axios";
import {
  authHeaders,
  getPageWithVersion,
  putPageStorage,
  getRemoteHash,
  setRemoteHash,
  listAttachments as listAttachmentsSet,
  ensureAttachment as ensureAttachmentUtil,
  explainAxios,
  makeClient,
} from "./confluence-rest.ts";
import * as p from "node:path";
import {
  type ExportHash,
  isExportHash,
} from "../domain/entities.ts";

export class ConfluencePageRepository implements IPageRepository {
  private readonly cfg: ConfluenceCfg;
  private readonly ax: AxiosInstance;

  constructor(cfg: ConfluenceCfg, ax?: AxiosInstance) {
    this.cfg = cfg;
    this.ax = ax ??
      axios.create({
        baseURL: cfg.baseUrl as unknown as string,
        headers: {
          ...authHeaders(cfg),
          Accept: "application/json",
        },
      });
  }

  async get(
    pageId: PageId,
  ): Promise<{ id: PageId; version: number; title: string } | null> {
    const meta = await getPageWithVersion(
      this.cfg,
      pageId as unknown as string,
      this.ax,
    );
    if (!meta) return null;
    const currentVersion = meta.nextVersion - 1;
    return { id: pageId, version: currentVersion, title: meta.title };
  }

  async putStorageBody(
    pageId: PageId,
    storage: StorageXhtml,
    title?: string,
  ): Promise<{ id: PageId; version: number }> {
    try {
      const meta = await getPageWithVersion(
        this.cfg,
        pageId as unknown as string,
        this.ax,
      );
      if (!meta) throw new Error(`Page ${String(pageId)} not found`);
      const next = meta.nextVersion;
      const ttl = title ?? meta.title ?? "authord";
      const res = await putPageStorage(
        this.cfg,
        pageId as unknown as string,
        ttl,
        next,
        storage as unknown as string,
        this.ax,
      );
      return { id: pageId, version: res.version };
    } catch (err) {
      throw explainAxios(err, "Failed to update page content");
    }
  }
}

export class ConfluenceAttachmentRepository implements IAttachmentRepository {
  private readonly cfg: ConfluenceCfg;
  private readonly ax: AxiosInstance;

  constructor(cfg: ConfluenceCfg, ax?: AxiosInstance) {
    this.cfg = cfg;
    this.ax = makeClient(cfg, ax);
  }

  async list(pageId: PageId): Promise<readonly AttachmentInfo[]> {
    const names = await listAttachmentsSet(
      this.cfg,
      pageId as unknown as string,
      this.ax,
    );
    // We don't have ids here without extra calls; expose filename as id for now.
    return Array.from(names).map((fn) => ({
      id: fn,
      fileName: fn,
      mediaType: undefined,
      sizeBytes: undefined,
    }));
  }

  async uploadOrHeal(
    pageId: PageId,
    filePath: Path,
    fileName?: string,
    contentType?: string,
  ): Promise<AttachmentInfo> {
    const abs = fileName
      ? p.resolve(p.dirname(filePath as unknown as string), fileName)
      : (filePath as unknown as string);
    await ensureAttachmentUtil(
      this.cfg,
      pageId as unknown as string,
      abs,
      this.ax,
    );
    const fname = fileName ?? p.basename(abs);
    return {
      id: fname,
      fileName: fname,
      mediaType: contentType ?? "image/png",
    };
  }

  async ensure(
    pageId: PageId,
    filePath: Path,
    contentType?: string,
  ): Promise<AttachmentInfo> {
    await ensureAttachmentUtil(
      this.cfg,
      pageId as unknown as string,
      filePath as unknown as string,
      this.ax,
    );
    const fname = p.basename(filePath as unknown as string);
    return { id: fname, fileName: fname, mediaType: contentType ?? "image/png" };
  }
}

export class ConfluencePropertyStore implements IPropertyStore {
  private readonly cfg: ConfluenceCfg;
  private readonly ax: AxiosInstance;

  constructor(cfg: ConfluenceCfg, ax?: AxiosInstance) {
    this.cfg = cfg;
    this.ax = makeClient(cfg, ax);
  }

  async getExportHash(pageId: PageId): Promise<ExportHash | null> {
    const v = await getRemoteHash(
      this.cfg,
      pageId as unknown as string,
      this.ax,
    );
    return v && isExportHash(v) ? (v as ExportHash) : null;
  }

  async setExportHash(pageId: PageId, hash: ExportHash): Promise<void> {
    await setRemoteHash(
      this.cfg,
      pageId as unknown as string,
      hash as unknown as string,
      this.ax,
    );
  }
}
