export interface ValidationResult {
    filePath: string;
    errors: ValidationError[];
}

export interface TreeNode {
    file: string;             // markdown filename, e.g. "chapter1.md"
    index: number;            // 0-based sibling position
    parent: TreeNode | null;  // null for root pages
    children: TreeNode[];
}

export interface TocConfig {
    rootTitle: string;   // the instance-profile @name
    startPage: string;   // the instance-profile @start-page
    nodes: TreeNode[];// the toc-element tree
}

export interface TocElement {
    topic: string;
    title?: string;
    children: TocElement[];
    parent?: TocElement;
}

export interface InstanceProfile {
    id: string;
    name: string;
    'start-page'?: string;
    'toc-elements': TocElement[];
}

export interface WriterSideInstanceProfile extends InstanceProfile {
    filePath: string;
}

export interface AuthordConfig {
    topics?: { dir: string };
    images?: { dir: string; version?: string; 'web-path'?: string };
    instances?: InstanceProfile[];
    [key: string]: any;
}

export interface ConfluenceCfg {
    baseUrl: string;  // https://confluence.mycorp.com
    apiToken: string;  // Personal-Access-Token  (or password if you switch to basic auth)
}

export interface UploadResult { file: string; mediaId: string; }

export interface ConfluenceAttachment {
    id: string;
    title: string;
    version: AttachmentVersion;
    _links?: { download?: string };
}
export interface AttachmentResponse {
    results: ConfluenceAttachment[];
    size: number;
    _links?: { next?: string };
}

export interface PageHit { id: string; nextVersion: number; }
export interface PropertyData { key: string; value: string; version: { number: number } }

interface AttachmentVersion { number: number; }
interface ValidationError {
    type: 'LINK' | 'IMAGE' | 'ANCHOR';
    target: string;
    message: string;
}