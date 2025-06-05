// packages/core/src/services/ConsoleFileService.ts

import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import { promises as fs } from 'fs';
import AbstractFileService from './AbstractFileService';

export default class ConsoleFileService extends AbstractFileService {
  public async rename(oldPath: string, newPath: string): Promise<void> {
    throw new Error('Method not implemented.');
    void oldPath;
    void newPath;
  }

  public async fileExists(filePath: string): Promise<boolean> {
    // We actually provide a working implementation here:
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  public async createDirectory(filePath: string): Promise<boolean> {
    throw new Error('Method not implemented.');
    void filePath;
  }

  public async readFileAsString(filePath: string): Promise<string> {
    // Working implementation, so no throw:
    return fs.readFile(filePath, 'utf-8');
  }

  public async writeNewFile(filePath: string, content: string): Promise<void> {
    throw new Error('Method not implemented.');
    void filePath;
    void content;
  }

  public async updateFile(
    filePath: string,
    transformFn: (content: string) => string
  ): Promise<void> {
    throw new Error('Method not implemented.');
    void filePath;
    void transformFn;
  }

  public async deleteFileIfExists(filePath: string): Promise<void> {
    throw new Error('Method not implemented.');
    void filePath;
  }

  public async readJsonFile(filePath: string): Promise<any> {
    // Working implementation, so no throw:
    const text = await this.readFileAsString(filePath);
    return JSON.parse(text);
  }

  public async updateJsonFile(
    filePath: string,
    mutateFn: (jsonData: any) => any
  ): Promise<void> {
    throw new Error('Method not implemented.');
    void filePath;
    void mutateFn;
  }

  public async updateXmlFile(
    filePath: string,
    mutateFn: (parsedXml: any) => any
  ): Promise<void> {
    throw new Error('Method not implemented.');
    void filePath;
    void mutateFn;
  }

  public async getIndentationSetting(): Promise<string> {
    throw new Error('Method not implemented.');
  }
}
