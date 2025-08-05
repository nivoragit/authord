export interface ConfluenceCfg {
  baseUrl: string;
  email: string;
  apiToken: string;
}

export interface UploadResult {
  file: string;
  mediaId: string;
}

interface AttachmentVersion { number: number; }
interface ConfluenceAttachment {
  title: string;
  extensions?: { fileId: string };
  version: AttachmentVersion;
}
export interface AttachmentResponse {
  results: ConfluenceAttachment[];
  size: number;
  _links?: { next?: string };
}