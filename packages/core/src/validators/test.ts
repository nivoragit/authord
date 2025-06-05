import * as path from "path";

import AuthordDocumentManager from '../managers/AuthordDocumentManager';
import WriterSideDocumentManager from '../managers/WriterSideDocumentManager';
import { authortdSchemaValidator, writersideSchemaValidator } from './schemaValidators';
import { ConsoleNotifier } from '../notifier/ConsoleNotifier';
import { InstanceProfile } from "../types";
import ConsoleFileService from "../services/ConsoleFileService";
import { Notifier } from "../notifier/Notifier";
import { DocumentationManager } from "../managers/DocumentationManager";
import AbstractFileService from "../services/AbstractFileService";

async function checkConfigFiles(
    notifier: Notifier,
    consoleFileService: AbstractFileService,
    documentManager: DocumentationManager | undefined,
    configFiles: string[],
    workspaceRoot: string): Promise<void> {
    for (let i = 0; i < configFiles.length; i += 1) {
        const fileName = configFiles[i];
        const filePath = path.join(workspaceRoot, fileName);
        if (!await consoleFileService.fileExists(filePath)) {
            continue;
        }
        const schemaPath = path.join(
            '../../',
            'schemas',
            'authord-config-schema.json'
        );

        if (fileName === configFiles[1]) {
            // XML config
            documentManager = new WriterSideDocumentManager(filePath, notifier, consoleFileService);
            await documentManager.reload();

            // Validate against schema
            try {
                const configManager = documentManager as WriterSideDocumentManager;
                await writersideSchemaValidator(schemaPath, configManager.ihpData, configManager.getInstances(), consoleFileService);
            } catch (error: any) {

                notifier.showErrorMessage('Failed to initialize extension');
                notifier.showErrorMessage(`Invalid configuration file: ${error.message}`);
                break;
            }
        } else {
            // Authord config (default / fallback)
            documentManager = new AuthordDocumentManager(filePath, new ConsoleNotifier(), consoleFileService);
            await documentManager.reload();

            try {

                await authortdSchemaValidator(schemaPath, (documentManager as AuthordDocumentManager).configData!, consoleFileService);
            } catch (error: any) {
                notifier.showErrorMessage(`Failed to validate: ${error.message}`);
                break;
            }
        }
        notifier.showInformationMessage(`validation successfull on config file: ${filePath}`)
        break;
    }
}

const configFiles = ['authord.config.json', 'writerside.cfg'];
const notifier = new ConsoleNotifier();
const consoleFileService = new ConsoleFileService()
const workspaceRoot = './';
checkConfigFiles(notifier, consoleFileService, undefined, configFiles, workspaceRoot)
    .catch((err) => console.error("Error during config check:", err));


