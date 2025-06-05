import { Notifier } from "./Notifier";

export class ConsoleNotifier implements Notifier {
  async showErrorMessage(message: string): Promise<string | undefined> {
    console.error(`Error: ${message}`);
    return undefined;
  }

  async showWarningMessage(message: string): Promise<string | undefined> {
    console.warn(`Warning: ${message}`);
    return undefined;
  }

  async showInformationMessage(message: string): Promise<string | undefined> {
    console.info(`Info: ${message}`);
    return undefined;
  }
}