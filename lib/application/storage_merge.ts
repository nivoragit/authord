// src/application/storage_merge.ts
/** Merge multiple Confluence storage fragments under a single storage root <div>. */
export function mergeStorageFragments(parts: string[]): string {
  const strip = (xml: string): string => {
    const m = xml.match(/^\s*<div\b[^>]*>([\s\S]*?)<\/div>\s*$/i);
    return m ? m[1] : xml;
  };
  const inner = parts.map(strip).join("\n");
  return `<div xmlns:ac="http://atlassian.com/content" xmlns:ri="http://atlassian.com/resource/identifier">${inner}</div>`;
}
