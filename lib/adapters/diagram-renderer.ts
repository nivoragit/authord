// Adapter implementing IDiagramRenderer using the mermaid CLI helper.

import type { IDiagramRenderer } from "../ports/ports.ts";
import type { Path } from "../utils/types.ts";
import { renderMermaidDefinitionToFile, type MermaidRenderOptions } from "../utils/mermaid.ts";

export class MermaidRenderer implements IDiagramRenderer {
  /** Render a Mermaid definition to a PNG at outPath. */
  async renderMermaid(
    mermaid: string,
    outPath: Path,
    opts?: MermaidRenderOptions,
  ): Promise<Path> {
    await renderMermaidDefinitionToFile(mermaid, outPath as unknown as string, opts);
    return outPath;
  }
}
