import axios from 'axios';
import fs from 'fs/promises';
import { readFileSync } from 'fs';
import path from 'path';
import FormData from 'form-data';
import sizeOf from 'image-size';
import { v4 as uuidv4 } from 'uuid';

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
interface AttachmentResponse {
  results: ConfluenceAttachment[];
  size: number;
  _links?: { next?: string };
}

interface PageHit { id: string; nextVersion: number; }
interface PropertyData { key: string; value: string; version: { number: number } }

/* ─────────── Content CRUD & versioning ────────── */
export async function findPageWithVersion(
  cfg: ConfluenceCfg,
  space: string,
  title: string
): Promise<PageHit | undefined> {
  const { data } = await axios.get(
    `${cfg.baseUrl}/wiki/rest/api/content`,
    {
      params: { spaceKey: space, title, status: 'current', expand: 'version' },
      auth: { username: cfg.email, password: cfg.apiToken },
    }
  );
  const hit = data.results?.[0];
  if (!hit) return undefined;
  return { id: hit.id as string, nextVersion: (hit.version.number as number) + 1 };
}

export async function putPage(
  cfg: ConfluenceCfg,
  pageId: string,
  title: string,
  adf: any,
  version: number,
): Promise<void> {
  await axios.put(
    `${cfg.baseUrl}/wiki/rest/api/content/${pageId}`,
    {
      id: pageId,
      title,
      type: 'page',
      version: { number: version },
      body: { atlas_doc_format: { value: JSON.stringify(adf), representation: 'atlas_doc_format' } },
    },
    { auth: { username: cfg.email, password: cfg.apiToken } }
  );
}

export async function createPage(
  cfg: ConfluenceCfg,
  space: string,
  title: string,
  adf: any,
): Promise<string> {
  const { data } = await axios.post(
    `${cfg.baseUrl}/wiki/rest/api/content`,
    { type: 'page', title, space: { key: space }, body: { atlas_doc_format: { value: JSON.stringify(adf), representation: 'atlas_doc_format' } } },
    { auth: { username: cfg.email, password: cfg.apiToken } }
  );
  return data.id as string;
}

/* ───── Content-property management ───── */
export async function getRemoteProperty(
  cfg: ConfluenceCfg,
  pageId: string
): Promise<PropertyData | undefined> {
  try {
    const { data } = await axios.get(
      `${cfg.baseUrl}/wiki/rest/api/content/${pageId}/property/exportHash`,
      { auth: { username: cfg.email, password: cfg.apiToken } }
    );
    return data as PropertyData;
  } catch (err: any) {
    if (err.response?.status === 404) return undefined;
    throw err;
  }
}

export async function setRemoteHash(
  cfg: ConfluenceCfg,
  pageId: string,
  hash: string
): Promise<void> {
  const prop = await getRemoteProperty(cfg, pageId);
  if (prop) {
    await axios.put(
      `${cfg.baseUrl}/wiki/rest/api/content/${pageId}/property/exportHash`,
      { value: hash, version: { number: prop.version.number + 1 } },
      { auth: { username: cfg.email, password: cfg.apiToken } }
    );
  } else {
    await axios.post(
      `${cfg.baseUrl}/wiki/rest/api/content/${pageId}/property`,
      { key: 'exportHash', value: hash },
      { auth: { username: cfg.email, password: cfg.apiToken } }
    );
  }
}

/* ───── Attachment listing ───── */
export async function listAttachments(
  cfg: ConfluenceCfg,
  pageId: string
): Promise<Set<string>> {
  let url = `${cfg.baseUrl}/wiki/rest/api/content/${pageId}/child/attachment?limit=200`;
  const names = new Set<string>();
  while (url) {
    const { data } = await axios.get(url, { auth:{ username:cfg.email, password:cfg.apiToken } });
    for (const att of data.results) names.add(att.title as string);
    url = data._links?.next ? cfg.baseUrl + data._links.next : '';
  }
  return names;
}

/* ───── Upload / ensure attachment ───── */
export async function uploadImages(
  cfg: ConfluenceCfg,
  pageId: string,
  cacheImagesPath: string
): Promise<UploadResult> {
  const fileName = path.basename(cacheImagesPath);
  const url = `${cfg.baseUrl}/wiki/rest/api/content/${pageId}/child/attachment`;
  const pngContent = await fs.readFile(cacheImagesPath);
  const form = new FormData();
  form.append('file', pngContent, { filename: fileName, contentType: 'image/png', knownLength: pngContent.length });
  try {
    const { data } = await axios.post(url, form, { headers: {...form.getHeaders(), 'X-Atlassian-Token':'no-check', Authorization:`Basic ${Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString('base64')}`}, maxBodyLength:Infinity, maxContentLength:Infinity });
    if (!data.results?.length) throw new Error(`No results for ${fileName}`);
    const mediaId = data.results[0].extensions?.fileId;
    if (!mediaId) throw new Error(`No fileId in response for ${fileName}`);
    return { file: fileName, mediaId };
  } catch (err: any) {
    const dup = axios.isAxiosError(err) && err.response?.status===400 && typeof err.response.data.message==='string' && err.response.data.message.includes('same file name');
    if (dup) return ensureAttachment(cfg,pageId,cacheImagesPath);
    throw err;
  }
}

export async function ensureAttachment(
  cfg: ConfluenceCfg,
  pageId: string,
  pngPath: string
): Promise<UploadResult> {
  const fileName = path.basename(pngPath);
  let latestMediaId: string|undefined;
  let latestVersion = -1;
  let start = 0;
  const limit = 100;
  while (true) {
    const searchUrl = `${cfg.baseUrl}/wiki/rest/api/content/${pageId}/child/attachment?filename=${encodeURIComponent(fileName)}&expand=extensions,version&start=${start}&limit=${limit}`;
    const resp = await axios.get<AttachmentResponse>(searchUrl,{ auth:{ username:cfg.email,password:cfg.apiToken } });
    for (const att of resp.data.results) {
      if (att.title===fileName && att.extensions?.fileId && att.version.number>latestVersion) {
        latestVersion = att.version.number;
        latestMediaId = att.extensions.fileId;
      }
    }
    if (!(resp.data.size>=limit && resp.data._links?.next)) break;
    start += limit;
  }
  if (!latestMediaId) throw new Error(`No existing attachment for ${fileName}`);
  return { file: fileName, mediaId: latestMediaId };
}

/* ───── Move page ───── */
export async function movePage(
  cfg: ConfluenceCfg,
  pageId: string,
  newParent: string
): Promise<void> {
  const url = `${cfg.baseUrl}/wiki/rest/api/content/${pageId}/move/append?targetId=${newParent}`;
  await axios.post(url, null, { auth:{ username:cfg.email,password:cfg.apiToken } });
}

/* ───── Media-node injection ───── */
export function injectMediaNodes(
  adf: any,
  map: Record<string,string>,
  pageId: string,
  imageDir: string
): any {
  const walk = (node: any): any => {
    if (Array.isArray(node)) return node.map(walk).filter(Boolean);
    if (!node||typeof node!=='object') return node;
    if (node.type==='paragraph'&&node.content?.[0]?.type==='text'&&node.content[0].text.startsWith('ATTACH-STUB:')) {
      const raw=node.content[0].text.slice(12,-2);
      const [file,params='']=raw.split('|');
      const mediaId=map[file];
      const prm=Object.fromEntries(params.split(';').map((p: string)=>p.split('=').map((s: string)=>s.trim())) as any);
      const width=prm.width?Number(prm.width):undefined;
      let height: number|undefined;
      if(width){try{const buf=readFileSync(path.join(imageDir,file));const dims=sizeOf(buf);if(dims.width&&dims.height)height=Math.round((dims.height/dims.width)*width);}catch{} }
      return {type:'mediaSingle',attrs:{layout:'center'},content:[{type:'media',attrs:{id:mediaId,type:'file',collection:`contentId-${pageId}`,occurrenceKey:uuidv4(),...(width!==undefined&&{width}),...(height!==undefined&&{height})}}]};
    }
    if (node.type==='mediaSingle'&&node.content?.[0]?.type==='media'&&node.content[0].attrs.type==='external') {
      const media=node.content[0];const file=path.basename(media.attrs.url);const mediaId=map[file];
      media.attrs={id:mediaId,type:'file',collection:`contentId-${pageId}`,occurrenceKey:uuidv4()};
    }
    if(node.content)node.content=walk(node.content);
    return node;
  };
  return walk(adf);
}

/* ───── Used images detection ───── */
export function usedImagesInADF(adf: any): Set<string> {
  const found=new Set<string>();
  const walk=(n:any):void=>{
    if(!n||typeof n!=='object')return;
    if(Array.isArray(n))return n.forEach(walk);
    if(n.type==='paragraph'&&n.content?.[0]?.text?.startsWith('ATTACH-STUB:')){
      const raw=n.content[0].text.slice(12,-2);found.add(raw.split('|')[0]);
    }
    if(n.type==='mediaSingle'&&n.content?.[0]?.attrs?.type==='external')found.add(path.basename(n.content[0].attrs.url));
    if(n.content)walk(n.content);
  };
  walk(adf);
  return found;
}

/* ───── Build media map ───── */
export async function buildMediaMap(
  cfg: ConfluenceCfg,
  pageId: string,
  imageDir: string,
  needed: Iterable<string>,
): Promise<Record<string,string>> {
  const map: Record<string,string>={};
  for(const img of needed){const abs=path.join(imageDir,img);let mediaId:string;try{({mediaId}=await ensureAttachment(cfg,pageId,abs));}catch{({mediaId}=await uploadImages(cfg,pageId,abs));}map[img]=mediaId;}return map;
}
