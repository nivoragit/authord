const MACRO = /%([a-zA-Z0-9._-]+)%/g;

export function expandMacros(text: string, dict: Record<string, string>): string {
  return text.replace(MACRO, (_, key) => (key in dict ? dict[key] : `%${key}%`));
}
