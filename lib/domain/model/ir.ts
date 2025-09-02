// Intermediate Representation (IR) types

export interface IRConfig {
  topicsDir: string;
  snippetsDir: string;
  imagesDir: { dir: string; webPath?: string };
  instances: { src: string; webPath?: string }[];
}

export interface IRInstance {
  id: string;
  name: string;
  startPage: string;
  isLibrary?: boolean;
  webPath?: string;
  toc: IRTocItem[];
}

export interface IRTocItem {
  title?: string;// todo
  topic?: string;
  file?: string; // todo
  children: IRTocItem[];
}
