/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable import/no-unresolved */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable class-methods-use-this */

import 'jest';
import * as path from 'path';
import { InstanceProfile, TocElement } from '../types';
import FileService from '../services/FileService';
import AbstractDocumentationManager from './AbstractDocumentationManager';
import { Notifier } from '../notifier/Notifier';

jest.mock('vscode');
// Correctly mock the FileService class
jest.mock('../services/FileService', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      deleteFileIfExists: jest.fn().mockResolvedValue(true),
      fileExists: jest.fn().mockResolvedValue(false),
      readFileAsString: jest.fn().mockResolvedValue(''),
      writeNewFile: jest.fn().mockResolvedValue(undefined),
      updateFile: jest.fn().mockImplementation(async (_path: string, updater: any) => {
        let content = '';
        await updater(content);
      }),
    })),
  };
});

const vscode = require('vscode'); // fix vscode import

class MockDocumentManager extends AbstractDocumentationManager {
  constructor(configPath: string) {
    const notifier = {} as Notifier; // Provide a mock Notifier
    const fileService = new (FileService as unknown as jest.Mock)(); // Create a mock FileService instance
    super(configPath, notifier, fileService);
  }

  async saveInstance(_doc: InstanceProfile, _filePath?: string): Promise<void> {
    // Mock implementation
  }

  getTopicsDirectory(): string {
    return '/mock/topics';
  }

  getImagesDirectory(): string {
    return '/mock/images';
  }

  async createInstance(_newDocument: InstanceProfile): Promise<void> {
    // Mock implementation
  }

  async removeInstance(_docId: string): Promise<boolean> {
    return true;
  }

  async reload(): Promise<void> {
    // Mock implementation
  }

  public testExtractMarkdownTitle(topicFile: string): Promise<string> {
    return super.extractMarkdownTitle(topicFile);
  }

  public testcreateMarkdownFile(newTopic: TocElement): Promise<string> {
    return super.createMarkdownFile(newTopic);
  }
}

describe('DocumentManager', () => {
  let manager: MockDocumentManager;

  beforeEach(() => {
    manager = new MockDocumentManager('/mock/config.json');
    jest.clearAllMocks();
    jest.spyOn(manager, 'saveInstance').mockResolvedValue(undefined);
  });

  describe('fetchAllDocumentations', () => {
    it('should return all instances', () => {
      const mockInstances: InstanceProfile[] = [{ id: '1', name: 'Test', 'toc-elements': [] }];
      (manager as any)['instances'] = mockInstances;
      expect(manager.getInstances()).toEqual(mockInstances);
    });
  });

  describe('renameTopicFile', () => {
    it('should rename the file and save config', async () => {
      const mockDoc: InstanceProfile = { id: '1', name: 'Doc', 'toc-elements': [] };
      const oldFile = 'old.md';
      const newFile = 'new.md';
      const topicsDir = manager.getTopicsDirectory();

      await manager.moveTopic(oldFile, newFile, mockDoc);

      expect(vscode.workspace.fs.rename).toHaveBeenCalledWith(
        expect.objectContaining({ path: path.join(topicsDir, oldFile) }),
        expect.objectContaining({ path: path.join(topicsDir, newFile) })
      );
      expect(manager.saveInstance).toHaveBeenCalledWith(mockDoc);
    });
  });

  describe('removeTopicFiles', () => {
    it('should delete files and save config', async () => {
      const mockDoc: InstanceProfile = { id: '1', name: 'Doc', 'toc-elements': [] };
      const files = ['file1.md', 'file2.md'];
      const topicsDir = manager.getTopicsDirectory();

      await expect(manager.removeTopics(files, mockDoc)).resolves.toBe(true);

      const fileServiceInstance = (manager as any).fileService;
      expect(fileServiceInstance.deleteFileIfExists).toHaveBeenCalledTimes(2);
      expect(fileServiceInstance.deleteFileIfExists).toHaveBeenCalledWith(path.join(topicsDir, files[0]));
      expect(fileServiceInstance.deleteFileIfExists).toHaveBeenCalledWith(path.join(topicsDir, files[1]));
      expect(manager.saveInstance).toHaveBeenCalledWith(mockDoc);
    });
  });

  describe('createChildTopicFile', () => {
    it('should create topic file and save config if file exists', async () => {
      const mockTopic = { topic: 'new.md', title: 'New', children: [] };
      const mockDoc = { id: '1', name: 'Doc', 'toc-elements': [] };
      const fileServiceInstance = (manager as any).fileService;
      (fileServiceInstance.fileExists as jest.Mock).mockResolvedValue(true);
      jest.spyOn(Object.getPrototypeOf(manager), 'createMarkdownFile').mockImplementation(async () => 'mockfile.md');

      await manager.createChildTopic(mockTopic, mockDoc);

      expect(Object.getPrototypeOf(manager).createMarkdownFile).toHaveBeenCalledWith(mockTopic);
      expect(manager.saveInstance).toHaveBeenCalledWith(mockDoc);
    });

    it('should not save config if file creation failed (file does not exist)', async () => {
      const mockTopic: TocElement = { topic: 'new.md', title: 'New', children: [] };
      const mockDoc: InstanceProfile = { id: '1', name: 'Doc', 'toc-elements': [] };
      const fileServiceInstance = (manager as any).fileService;
      (fileServiceInstance.fileExists as jest.Mock).mockResolvedValue(false);
      jest.spyOn(manager, 'testcreateMarkdownFile').mockImplementation(async () => '');

      await manager.createChildTopic(mockTopic, mockDoc);

      expect(manager.saveInstance).not.toHaveBeenCalled();
    });
  });

  describe('extractMarkdownTitle', () => {
    it('should extract title from first heading', async () => {
      const fileServiceInstance = (manager as any).fileService;
      (fileServiceInstance.readFileAsString as jest.Mock).mockResolvedValue('# Title\nContent');
      const title = await manager.testExtractMarkdownTitle('test.md');
      expect(title).toBe('Title');
    });

    it('should use filename if no heading found', async () => {
      const fileServiceInstance = (manager as any).fileService;
      (fileServiceInstance.readFileAsString as jest.Mock).mockResolvedValue('Content');
      const title = await manager.testExtractMarkdownTitle('test.md');
      expect(title).toBe('<test.md>');
    });

    it('should handle read errors gracefully', async () => {
      const fileServiceInstance = (manager as any).fileService;
      (fileServiceInstance.readFileAsString as jest.Mock).mockRejectedValue(new Error('Read failed'));
      const title = await manager.testExtractMarkdownTitle('error.md');
      expect(title).toBe('<error.md>');
    });
  });

  describe('updateMarkdownTitle', () => {
    it('should update existing title', async () => {
      let content = '# Old Title\nContent';
      const fileServiceInstance = (manager as any).fileService;
      (fileServiceInstance.updateFile as jest.Mock).mockImplementation(async (_path: string, updater: any) => {
        content = await updater(content);
      });

      await manager.setTopicTitle('test.md', 'New Title');
      expect(content).toBe('# New Title\nContent');
    });

    it('should prepend title if none exists', async () => {
      let content = 'Content';
      const fileServiceInstance = (manager as any).fileService;
      (fileServiceInstance.updateFile as jest.Mock).mockImplementation(async (_path: string, updater: any) => {
        content = await updater(content);
      });

      await manager.setTopicTitle('test.md', 'New Title');
      expect(content).toBe('# New Title\nContent');
    });
  });
});
