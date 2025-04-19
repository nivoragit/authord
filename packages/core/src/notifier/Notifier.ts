export interface Notifier {
  showErrorMessage(message: string, ...items: string[]): Promise<string | undefined>;
  showWarningMessage(message: string, ...items: string[]): Promise<string | undefined>;
  showInformationMessage(message: string, ...items: string[]): Promise<string | undefined>;
}
