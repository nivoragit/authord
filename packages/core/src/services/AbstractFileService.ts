import { XMLParser, XMLBuilder } from 'fast-xml-parser';

export default abstract class AbstractFileService {
  public abstract rename(oldPath: string, newPath: string): Promise<void>;

  public abstract fileExists(filePath: string): Promise<boolean>;

  public abstract createDirectory(filePath: string): Promise<boolean>;

  public abstract readFileAsString(filePath: string): Promise<string>;

  public abstract writeNewFile(filePath: string, content: string): Promise<void>;

  public abstract updateFile(filePath: string, transformFn: (content: string) => string): Promise<void>;

  public abstract deleteFileIfExists(filePath: string): Promise<void>;

  public abstract readJsonFile(filePath: string): Promise<any>;

  public abstract updateJsonFile(filePath: string, mutateFn: (jsonData: any) => any): Promise<void>;

  public abstract updateXmlFile(filePath: string, mutateFn: (parsedXml: any) => any): Promise<void>;

  public abstract getIndentationSetting(): Promise<string>;

  public static parseXmlString(xmlText: string): any {
    const parser = new XMLParser({ ignoreAttributes: false });
    return parser.parse(xmlText);
  }

  public static async buildXmlString(xmlData: any): Promise<string> {
    const builder = new XMLBuilder({
      ignoreAttributes: false,
      format: true,
      indentBy: '  ',
      suppressEmptyNode: true
    });
    return builder.build(xmlData);
  }
}
