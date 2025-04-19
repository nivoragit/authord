// eslint-disable-next-line import/no-unresolved
// import * as vscode from 'vscode';
import * as path from 'path';
import { InstanceProfile, TocElement } from '../types';
import FileService from '../services/FileService';
import { DocumentationManager } from './DocumentationManager';
import { Notifier } from '../notifier/Notifier';

export default abstract class AbstractDocumentationManager implements DocumentationManager {
    configPath: string;
    notifier: Notifier;
    fileService: FileService;
    protected instances: InstanceProfile[] = [];

    constructor(configPath: string, notifier: Notifier, fileService: FileService) {
        this.configPath = configPath;
        this.notifier = notifier;
        this.fileService = fileService;
    }

    public abstract saveInstance(
        _doc: InstanceProfile,
        _filePath?: string
    ): Promise<void>;

    abstract getTopicsDirectory(): string;
    abstract getImagesDirectory(): string;

    // Document-specific methods
    abstract createInstance(newDocument: InstanceProfile): Promise<void>;
    abstract removeInstance(docId: string, allTopics: string[]): Promise<boolean>;

    // Refresh configuration
    abstract reload(): Promise<void>;

    getInstances(): InstanceProfile[] {
        return this.instances;
    }

    /**
     * Renames a topic’s file on disk and updates config accordingly.
     */
    async moveTopic(
        oldTopicFile: string,
        newTopicFile: string,
        doc: InstanceProfile
    ): Promise<void> {
        const topicsDir = this.getTopicsDirectory();
        const oldPath = path.join(topicsDir, oldTopicFile);
        const newPath = path.join(topicsDir, newTopicFile);
        this.fileService.rename(oldPath, newPath);
        await this.saveInstance(doc);
    }

    /**
     * Deletes one or more topic files -> removes from disk -> updates .tree/config.
     */
    async removeTopics(topicsFilestoBeRemoved: string[], doc: InstanceProfile): Promise<boolean> {
        const topicsDir = this.getTopicsDirectory();
        await Promise.all(
            topicsFilestoBeRemoved.map(async (tFile) =>
                this.fileService.deleteFileIfExists(path.join(topicsDir, tFile))
            )
        );
        await this.saveInstance(doc);
        return true;
    }

    /**
     * Adds a new child topic (and file) -> updates config if file is created.
     */
    async createChildTopic(
        newTopic: TocElement,
        doc: InstanceProfile
    ): Promise<string> {
        const filePath = await this.createMarkdownFile(newTopic);
        const fileExists = await this.fileService.fileExists(path.join(this.getTopicsDirectory(), newTopic.topic));
        if (fileExists) {
            await this.saveInstance(doc);
        }
        return filePath;
    }

    /**
     * Retrieves the title from a Markdown file’s first heading or uses fallback.
     */
    protected async extractMarkdownTitle(topicFile: string): Promise<string> {
        try {
            const mdFilePath = path.join(this.getTopicsDirectory(), topicFile);
            const content = await this.fileService.readFileAsString(mdFilePath);
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i += 1) {
                const line = lines[i].trim();
                if (line.startsWith('# ')) {
                    return line.substring(1).trim();
                }
                if (line.length > 0) {
                    break;
                }
            }
        } catch {
            // ignore
        }
        return `<${path.basename(topicFile)}>`;
    }

    public async setTopicTitle(topicFile: string, newTitle: string): Promise<void> {
        const mdFilePath = path.join(this.getTopicsDirectory(), topicFile);

        await this.fileService.updateFile(mdFilePath, (content: any) => {
            const lines = content.split('\n');

            for (let i = 0; i < lines.length; i += 1) {
                if (lines[i].trim().startsWith('# ')) {
                    lines[i] = `# ${newTitle}`;
                    return lines.join('\n');
                }
                if (lines[i].trim().length > 0) break;
            }

            // No title found, prepend it
            return `# ${newTitle}\n${content}`;
        });
    }



    /**
     * Writes a new .md file for the topic, if it doesn’t exist.
     */
    protected async createMarkdownFile(newTopic: TocElement): Promise<string> {
        try {
            const topicsDir = this.getTopicsDirectory();
            await this.fileService.createDirectory(topicsDir);

            const filePath = path.join(topicsDir, newTopic.topic);
            if (await this.fileService.fileExists(filePath)) {
                this.notifier.showWarningMessage(`Topic file "${newTopic.topic}" already exists.`);
                return "";
            }

            await this.fileService.writeNewFile(
                filePath,
                `# ${newTopic.title}\n\nContent goes here...`
            ); 
            return filePath;
        } catch (err: any) {
            this.notifier.showErrorMessage(`Failed to write topic file "${newTopic.topic}": ${err.message}`);
            throw err;
        }
    }
}
