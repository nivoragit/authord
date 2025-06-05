export interface Notifier {
  showErrorMessage(message: string): Promise<string | undefined>;
  showWarningMessage(message: string): Promise<string | undefined>;
  showInformationMessage(message: string): Promise<string | undefined>;
}
