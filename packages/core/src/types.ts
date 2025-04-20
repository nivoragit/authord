/**
 * Product configuration
 */
export interface Product<
  TE extends TocElement = TocElement,
  IP extends InstanceProfile<TE> = InstanceProfile<TE>
> {
  /** The product version */
  version: string;
  /** Product root directory */
  workspaceDir: string;
  /** Directory for topics */
  topicsDir: string;
  /** Directory for images */
  imagesDir: string;
  /** Instance profile configuration */
  instanceProfiles: Map<string, IP>;

}

/**
 * Instance profile configuration
 */
export interface InstanceProfile<TE extends TocElement> {
  /** Unique identifier for the instance profile */
  id: string;
  /** Human-readable name for the instance profile */
  name: string;
  /** Path to the start page */
  startPage: string;
  /** Root table of contents elements */
  tocElements: TE[];
  /** Version of the instance profile */
  version: string;

}

/**
 * Table of contents element
 */
export interface TocElement {
  /** Path to the topic file */
  topic: string;
  /** Optional display title (nullable) */
  title?: string | null;
  /** parent node */
  parent?: TocElement;
  /** Nested table of contents elements */
  children?: TocElement[];
}

/** Abstraction for basic asynchronous filesystem operations */
export interface FileSystem {
  readFile(filePath: string): Promise<string>;
  exists(filePath: string): Promise<boolean>;
}

