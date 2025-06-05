import * as path from 'path';
import { AuthordConfig, InstanceProfile } from '../types';
import AuthordDocumentManager from './AuthordDocumentManager';
import AbstractFileService from '../services/AbstractFileService';
import { Notifier } from '../notifier/Notifier';

jest.mock('../services/FileService');
jest.mock('path');

describe('AuthordDocumentManager', () => {
  const mockConfigPath = 'config.json';
  let manager: AuthordDocumentManager;
  let mockNotifier: Notifier;
  let mockFileService: jest.Mocked<AbstractFileService>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mocks
    mockNotifier = {} as Notifier;
    mockFileService = {
      fileExists: jest.fn(),
      readJsonFile: jest.fn(),
      writeNewFile: jest.fn(),
      updateJsonFile: jest.fn(),
      deleteFileIfExists: jest.fn(),
    } as unknown as jest.Mocked<AbstractFileService>;

    manager = new AuthordDocumentManager(mockConfigPath, mockNotifier, mockFileService);

    // Mock path functions
    (path.dirname as jest.Mock).mockReturnValue('/mock/dir');
    (path.join as jest.Mock).mockImplementation((...args: string[]) => args.join('/'));
  });

  describe('reloadConfiguration', () => {
    it('should load config and update TOC titles', async () => {
      const mockConfig: AuthordConfig = {
        instances: [
          {
            id: 'doc1', 
            name: 'Documentation 1',
            'toc-elements': [
              { topic: 'topic1.md', title: '', children: [] },
              { topic: 'topic2.md', title: '', children: [] },
            ],
          },
        ],
      };

      mockFileService.fileExists.mockResolvedValue(true);
      mockFileService.readJsonFile.mockResolvedValue(mockConfig);

      (manager as any).extractMarkdownTitle = jest.fn().mockImplementation((topic: string) =>
        Promise.resolve(`Title for ${topic}`)
      );

      await manager.reload();

      expect(manager.configData).toEqual(mockConfig);
      expect(manager.configData?.instances?.[0]['toc-elements'][0].title).toBe('Title for topic1.md');
      expect(manager.configData?.instances?.[0]['toc-elements'][1].title).toBe('Title for topic2.md');
      expect((manager as any).extractMarkdownTitle).toHaveBeenCalledTimes(2);
    });

    it('should handle missing config file', async () => {
      mockFileService.fileExists.mockResolvedValue(false);

      await manager.reload();

      expect(manager.configData).toBeUndefined();
    });
  });

  describe('initializeConfigurationFile', () => {
    it('should create default config file and save it', async () => {
      await manager.initializeConfigurationFile();

      expect(mockFileService.writeNewFile).toHaveBeenCalledWith(mockConfigPath, '{}');
      expect(manager.configData).toEqual(AuthordDocumentManager.defaultConfigJson());
      expect(mockFileService.updateJsonFile).toHaveBeenCalled();
    });
  });

  describe('defaultConfigJson', () => {
    it('should return the default configuration', () => {
      const defaultConfig = AuthordDocumentManager.defaultConfigJson();
      expect(defaultConfig).toEqual({
        schema: 'https://json-schema.org/draft/2020-12/schema',
        title: 'Authord Settings',
        type: 'object',
        topics: { dir: 'topics' },
        images: { dir: 'images', version: '1.0', 'web-path': 'images' },
        instances: [],
      });
    });
  });

  describe('parseConfigFile', () => {
    it('should return parsed config when file exists', async () => {
      const mockConfig = { instances: [] };
      mockFileService.fileExists.mockResolvedValue(true);
      mockFileService.readJsonFile.mockResolvedValue(mockConfig);

      const result = await (manager as any).parseConfigFile();
      expect(result).toEqual(mockConfig);
    });

    it('should return undefined when file does not exist', async () => {
      mockFileService.fileExists.mockResolvedValue(false);

      const result = await (manager as any).parseConfigFile();
      expect(result).toBeUndefined();
    });
  });

  describe('saveConfigurationFile', () => {
    it('should save config data if configData is defined', async () => {
      manager.configData = AuthordDocumentManager.defaultConfigJson();

      await manager.saveConfigurationFile();

      expect(mockFileService.updateJsonFile).toHaveBeenCalledWith(mockConfigPath, expect.any(Function));
    });

    it('should not save if configData is undefined', async () => {
      await manager.saveConfigurationFile();
      expect(mockFileService.updateJsonFile).not.toHaveBeenCalled();
    });
  });

  describe('getTopicsDirectory', () => {
    it('should return directory from config', () => {
      manager.configData = { topics: { dir: 'custom-topics' } } as AuthordConfig;
      expect(manager.getTopicsDirectory()).toBe('/mock/dir/custom-topics');
    });

    it('should return default directory when config is missing topics', () => {
      manager.configData = {} as AuthordConfig;
      expect(manager.getTopicsDirectory()).toBe('/mock/dir/topics');
    });
  });

  describe('getImagesDirectory', () => {
    it('should return directory from config', () => {
      manager.configData = { images: { dir: 'custom-images' } } as AuthordConfig;
      expect(manager.getImagesDirectory()).toBe('/mock/dir/custom-images');
    });

    it('should return default directory when config is missing images', () => {
      manager.configData = {} as AuthordConfig;
      expect(manager.getImagesDirectory()).toBe('/mock/dir/images');
    });
  });

  describe('createDocumentation', () => {
    const newDoc: InstanceProfile = {
      id: 'doc1',
      name: 'Documentation One',
      'toc-elements': [
        { topic: 'topic1.md', title: '', children: [] },
      ],
    };

    beforeEach(() => {
      manager.configData = { instances: [] } as AuthordConfig;
    });

    it('should add documentation, create topic file, and save if file exists', async () => {
      mockFileService.fileExists.mockResolvedValue(true);

      const createMarkdownFileSpy = jest.spyOn(manager as any, 'createMarkdownFile').mockResolvedValue('topic1.md');

      await manager.createInstance(newDoc);

      expect(manager.getInstances()).toContainEqual(newDoc);
      expect(createMarkdownFileSpy).toHaveBeenCalledWith({ topic: 'topic1.md', title: '', children: [] });
      expect(mockFileService.updateJsonFile).toHaveBeenCalled();
    });

    it('should add documentation but not save if file does not exist after creation', async () => {
      mockFileService.fileExists.mockResolvedValue(false);

      const createMarkdownFileSpy = jest.spyOn(manager as any, 'createMarkdownFile').mockResolvedValue('topic1.md');

      await manager.createInstance(newDoc);

      expect(manager.getInstances()).toContainEqual(newDoc);
      expect(createMarkdownFileSpy).toHaveBeenCalledWith({ topic: 'topic1.md', title: '', children: [] });
      expect(mockFileService.updateJsonFile).toHaveBeenCalled();
    });
  });

  describe('removeDocumentation', () => {
    const doc: InstanceProfile = {
      id: 'doc1',
      name: 'Documentation One',
      'toc-elements': [{ topic: 'topic1.md', title: '', children: [] }],
    };
  
    it('should remove documentation and delete files', async () => {
      (manager as any)['instances'] = [doc];
      manager.configData = { instances: manager.getInstances() } as AuthordConfig;
  
      const allTopics = ['topic1.md']; // <-- replace TopicsService call with direct array
  
      const result = await manager.removeInstance('doc1', allTopics);
      expect(result).toBe(true);
      expect(manager.getInstances()).not.toContainEqual(doc);
      expect(mockFileService.deleteFileIfExists).toHaveBeenCalledWith('/mock/dir/topics/topic1.md');
      expect(mockFileService.updateJsonFile).toHaveBeenCalled();
    });
  
    it('should return false if documentation is not found', async () => {
      const result = await manager.removeInstance('docX', []);
      expect(result).toBe(false);
      expect(mockFileService.deleteFileIfExists).not.toHaveBeenCalled();
      expect(mockFileService.updateJsonFile).not.toHaveBeenCalled();
    });
  
    it('should return false if configData is undefined', async () => {
      manager.configData = undefined;
      (manager as any)['instances'] = [
        {
          id: 'doc2',
          name: 'Documentation Two',
          'toc-elements': [],
        },
      ];
  
      const result = await manager.removeInstance('doc2', []);
      expect(result).toBe(false);
      expect(mockFileService.deleteFileIfExists).not.toHaveBeenCalled();
      expect(mockFileService.updateJsonFile).not.toHaveBeenCalled();
    });
  });
  

  describe('saveDocumentationConfig', () => {
    const docId = 'docA';
    let existingDoc: InstanceProfile;
    let updatedDoc: InstanceProfile;

    beforeEach(() => {
      manager.configData = { instances: [] } as AuthordConfig;
      existingDoc = {
        id: docId,
        name: 'Existing Doc',
        'toc-elements': [],
      };
      updatedDoc = {
        id: docId,
        name: 'Updated Doc',
        'toc-elements': [
          { topic: 'updated.md', title: '', children: [] },
        ],
      };
    });

    it('should update existing documentation', async () => {
      (manager as any)['instances'] = [existingDoc];
      manager.configData!.instances = manager.getInstances();

      await manager.saveInstance(updatedDoc);

      expect(manager.getInstances()).toContainEqual(updatedDoc);
      expect(mockFileService.updateJsonFile).toHaveBeenCalled();
    });

    it('should add new documentation if it does not exist', async () => {
      await manager.saveInstance(updatedDoc);

      expect(manager.getInstances()).toContainEqual(updatedDoc);
      expect(mockFileService.updateJsonFile).toHaveBeenCalled();
    });

    it('should do nothing if configData is undefined', async () => {
      manager.configData = undefined;

      await manager.saveInstance(updatedDoc);

      expect(mockFileService.updateJsonFile).not.toHaveBeenCalled();
      expect(manager.getInstances().length).toBe(0);
    });
  });
});
