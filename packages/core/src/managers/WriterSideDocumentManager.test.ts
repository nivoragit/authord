/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable dot-notation */

import * as path from 'path';
import WriterSideDocumentManager from './WriterSideDocumentManager';
import AbstractFileService from '../services/AbstractFileService'; // Abstract class for instance methods
import FileService from '../services/AbstractFileService'; // Concrete import for static methods
import { InstanceProfile, WriterSideInstanceProfile } from '../types';
import { Notifier } from '../notifier/Notifier';


jest.mock('../services/FileService');
jest.mock('../services/TopicsService');
jest.mock('fast-xml-parser', () => ({
  XMLBuilder: jest.fn().mockImplementation(() => ({
    build: jest.fn().mockReturnValue('<xml/>'),
  })),
}));

describe('WriterSideDocumentManager', () => {
  const mockConfigPath = '/project/config.ihp';
  const mockIhpDir = path.dirname(mockConfigPath);

  let manager: WriterSideDocumentManager;
  let mockNotifier: Notifier;
  let mockFileService: jest.Mocked<AbstractFileService>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockNotifier = {} as Notifier;
    mockFileService = {
      fileExists: jest.fn(),
      readFileAsString: jest.fn(),
      writeNewFile: jest.fn(),
      updateXmlFile: jest.fn(),
      deleteFileIfExists: jest.fn(),
      getIndentationSetting: jest.fn(),
    } as unknown as jest.Mocked<AbstractFileService>;

    manager = new WriterSideDocumentManager(mockConfigPath, mockNotifier, mockFileService);
  });

  describe('reloadConfiguration', () => {
    it('should read IHP file and load all instances', async () => {
      const mockParsedData = { ihp: { instance: [] } };
      mockFileService.fileExists.mockResolvedValue(true);
      mockFileService.readFileAsString.mockResolvedValue('<ihp/>');
      (FileService.parseXmlString as jest.Mock).mockReturnValue(mockParsedData);
      jest.spyOn(manager, 'loadAllInstances').mockResolvedValue([]);

      await manager.reload();

      expect(mockFileService.fileExists).toHaveBeenCalledWith(mockConfigPath);
      expect(mockFileService.readFileAsString).toHaveBeenCalledWith(mockConfigPath);
      expect(manager.ihpData).toEqual(mockParsedData);
      expect(manager.loadAllInstances).toHaveBeenCalled();
    });
  });

  describe('Path-related methods', () => {
    it('should get IHP, topics, and images directories', () => {
      expect((manager as any).getIhpDir()).toBe(mockIhpDir);

      manager.ihpData = { ihp: {} };
      expect(manager.getTopicsDirectory()).toBe(path.join(mockIhpDir, 'topics'));
      expect(manager.getImagesDirectory()).toBe(path.join(mockIhpDir, 'images'));

      manager.ihpData = { ihp: { topics: { '@_dir': 'custom-topics' } } };
      expect(manager.getTopicsDirectory()).toBe(path.join(mockIhpDir, 'custom-topics'));

      manager.ihpData = { ihp: { images: { '@_dir': 'custom-images' } } };
      expect(manager.getImagesDirectory()).toBe(path.join(mockIhpDir, 'custom-images'));
    });
  });

  describe('readIhpFile', () => {
    it('should create and parse default IHP if missing', async () => {
      mockFileService.fileExists.mockResolvedValue(false);
      mockFileService.readFileAsString.mockResolvedValue('<ihp version="2.0"></ihp>');
      (FileService.parseXmlString as jest.Mock).mockReturnValue({ ihp: {} });

      const result = await (manager as any).readIhpFile();
      expect(mockFileService.writeNewFile).toHaveBeenCalled();
      expect(result).toEqual({ ihp: {} });
    });

    it('should parse existing IHP file', async () => {
      mockFileService.fileExists.mockResolvedValue(true);
      mockFileService.readFileAsString.mockResolvedValue('<ihp version="2.0"></ihp>');
      (FileService.parseXmlString as jest.Mock).mockReturnValue({ ihp: {} });

      const result = await (manager as any).readIhpFile();
      expect(result).toEqual({ ihp: {} });
    });
  });

  describe('writeIhpFile', () => {
    it('should update XML file', async () => {
      manager.ihpData = { ihp: { version: '2.0' } };
      await (manager as any).writeIhpFile();
      expect(mockFileService.updateXmlFile).toHaveBeenCalled();
    });
  });

  describe('loadAllInstances', () => {
    it('should handle empty or valid instances', async () => {
      manager.ihpData = { ihp: {} };
      expect(await manager.loadAllInstances()).toEqual([]);

      manager.ihpData = { ihp: { instance: [{ '@_src': 'valid.tree' }] } };
      mockFileService.fileExists.mockResolvedValue(true);
      jest.spyOn(manager as any, 'parseInstanceProfile').mockResolvedValue({ id: 'doc1' });

      const instances = await manager.loadAllInstances();
      expect(instances[0].id).toBe('doc1');
    });
  });

  describe('parseInstanceProfile', () => {
    it('should return parsed profile or null', async () => {
      mockFileService.readFileAsString.mockResolvedValue('<invalid></invalid>');
      (FileService.parseXmlString as jest.Mock).mockReturnValue({ invalid: {} });

      expect(await (manager as any).parseInstanceProfile('file')).toBeNull();

      mockFileService.readFileAsString.mockResolvedValue('<instance-profile id="doc1"></instance-profile>');
      (FileService.parseXmlString as jest.Mock).mockReturnValue({
        'instance-profile': { '@_id': 'doc1', '@_name': 'Doc1', 'toc-element': [] },
      });
      jest.spyOn(manager as any, 'buildTocElements').mockResolvedValue([]);

      const profile = await (manager as any).parseInstanceProfile('file');
      expect(profile.id).toBe('doc1');
    });
  });

  describe('buildTocElements', () => {
    it('should build TOC elements recursively', async () => {
      jest.spyOn(manager as any, 'extractMarkdownTitle').mockImplementation(async (file) => `Title ${file}`);
      const toc = await (manager as any).buildTocElements([{ '@_topic': 'main.md', 'toc-element': [{ '@_topic': 'child.md' }] }]);
      expect(toc[0].title).toBe('Title main.md');
      expect(toc[0].children[0].title).toBe('Title child.md');
    });

    it('should return empty array for null input', async () => {
      expect(await (manager as any).buildTocElements(null)).toEqual([]);
    });
  });

  describe('saveDocumentConfig', () => {
    it('should write new XML file', async () => {
      const mockDoc: WriterSideInstanceProfile = {
        id: 'doc1', name: 'Doc 1', 'start-page': '', 'toc-elements': [], filePath: '/doc.tree'
      };
      await manager.saveInstance(mockDoc);
      expect(mockFileService.writeNewFile).toHaveBeenCalled();
    });
  });

  describe('convertToXmlString', () => {
    it('should convert object to XML', async () => {
      mockFileService.getIndentationSetting.mockResolvedValue('  ');
      const xml = await (WriterSideDocumentManager as any).convertToXmlString({ test: {} });
      expect(xml).toBe('<xml/>');
    });
  });

  describe('createDocument', () => {
    it('should create a document instance', async () => {
      const newDoc: WriterSideInstanceProfile = {
        id: 'newdoc',
        name: 'New Doc',
        'start-page': '',
        'toc-elements': [{ topic: 'topic.md', title: '', children: [] }],
        filePath: '',
      };
      manager.ihpData = { ihp: {} };
      mockFileService.fileExists.mockResolvedValue(false);

      await manager.createInstance(newDoc);
      expect(manager.getInstances()[0].id).toBe('newdoc');
      expect(mockFileService.writeNewFile).toHaveBeenCalled();
    });
  });

  describe('removeDocument', () => {
    it('should remove document and associated files', async () => {
      manager.ihpData = { ihp: { instance: [{ '@_src': 'doc1.tree' }] } };
      (manager as any)['instances'] = [{
        id: 'doc1',
        name: 'Doc1',
        'start-page': '',
        'toc-elements': [{ topic: 'topic1.md', title: '', children: [] }],
      }];
      mockFileService.fileExists.mockResolvedValue(true);

      const result = await manager.removeInstance('doc1', ['topic1.md']);
      expect(result).toBe(true);
      expect(mockFileService.deleteFileIfExists).toHaveBeenCalledTimes(2);
    });

    it('should return false if document not found', async () => {
      manager.ihpData = { ihp: { instance: [] } };
      (manager as any)['instances'] = [];
      expect(await manager.removeInstance('docX', [])).toBe(false);
    });
  });

  describe('locateDocumentIndex', () => {
    it('should locate or not locate documents', async () => {
      const instances = [{ '@_src': 'doc1.tree' }];
      mockFileService.fileExists.mockResolvedValue(true);
      mockFileService.readFileAsString.mockResolvedValue('<instance-profile id="doc1"></instance-profile>');
      (FileService.parseXmlString as jest.Mock).mockReturnValue({ 'instance-profile': { '@_id': 'doc1' } });

      expect(await (manager as any).locateDocumentIndex(instances, 'doc1')).toBe(0);
      expect(await (manager as any).locateDocumentIndex([], 'missing')).toBe(-1);
    });
  });
});
