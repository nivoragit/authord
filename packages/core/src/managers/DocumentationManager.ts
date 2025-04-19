// IBaseConfigurationManager.ts

import {InstanceProfile, TocElement} from '../types';

export interface DocumentationManager {

    getTopicsDirectory(): string;

    getImagesDirectory(): string;

    createInstance(newInstance: InstanceProfile): Promise<void>;

    saveInstance(doc: InstanceProfile): Promise<void>;

    removeInstance(docId: string, allTopics: string[]): Promise<boolean>;

    reload(): Promise<void>;

    getInstances(): InstanceProfile[];

    moveTopic(
        source: string,
        destination: string,
        doc: InstanceProfile
    ): Promise<void>;

    removeTopics(topicsToBeRemoved: string[], doc: InstanceProfile): Promise<boolean>;

    createChildTopic(
        newTopic: TocElement,
        doc: InstanceProfile
    ): Promise<string>;

    setTopicTitle(topicFile: string, newTitle: string): Promise<void>;
}
