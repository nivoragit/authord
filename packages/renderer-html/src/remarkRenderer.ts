// src/utils/remarkRenderer.ts
import { markdownToAdf } from 'marklassian';
import { WritersideMarkdownTransformer } from './writerside-markdown-transformer';
// import { defaultSchema } from '@atlaskit/adf-schema/dist/types/schema/default-schema';

/**
 * Converts Markdown → ADF (via marklassian) and wraps the JSON
 * with CSS + two-way scroll-sync script for the VS Code preview.
 */
export async function renderContent(markdown: string): Promise<string> {
  // const adfDoc = markdownToAdf(markdown);          // returns plain ADF object
  // const jsonString = JSON.stringify(adfDoc);       // serialise for embedding
  // const escapedJson = jsonString.replace(/(?<!\\)"/g, '\\"');
  // console.log(escapedJson)
  // return wrapWithSyncScript(jsonString);

  const transformer = new WritersideMarkdownTransformer();
  // // const transformer = new MarkdownTransformer(defaultSchema);
  // const adfDocument = transformer.parse(markdown).toJSON();
  // adfDocument.version = 1;
  // const json_string = JSON.stringify(adfDocument, (_k, v) => v === null ? undefined : v);
  // const json_string = JSON.stringify(adfDocument)

  const json_string = JSON.stringify(transformer.toADF(markdown));

  const escapedJson = json_string.replace(/(?<!\\)"/g, '\\"');
  console.log(escapedJson)
  // Wrap the generated HTML with the embedded script and updated CSS for two-way scroll sync.
  return wrapWithSyncScript(json_string);
}

/**
 * Wraps the rendered content with styling and the embedded script
 * that keeps editor ↔ preview scroll positions in sync.
 */
function wrapWithSyncScript(innerHtml: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body {
      margin: 0;
      padding: 1rem;
    }
    .code-active-line {
      position: relative;
    }
    .code-active-line::before {
      content: "";
      position: absolute;
      top: 0;
      bottom: 0;
      left: -8px;
      width: 3px;
      background-color: var(--vscode-scrollbarSlider-activeBackground, rgba(230, 100, 100, 0.8));
    }
  </style>
</head>
<body>
  ${innerHtml}
  <script>
    const vscode = acquireVsCodeApi();
    let lines = [];
    let currentActive = null;

    function isElementVisible(el) {
      let current = el;
      while (current) {
        if (current.tagName === 'DETAILS' && !current.open) {
          return false;
        }
        current = current.parentElement;
      }
      return true;
    }

    function gatherLineElements() {
      const allLines = Array.from(document.querySelectorAll('.code-line'));
      lines = [];
      for (const el of allLines) {
        if (!isElementVisible(el)) continue;
        const lineVal = parseInt(el.getAttribute('data-line'), 10);
        const rect = el.getBoundingClientRect();
        const top = rect.top + window.scrollY;
        const height = rect.height;
        lines.push({ el, line: lineVal, top, height });
      }
      lines.sort((a, b) => a.top - b.top);
    }

    function findClosestLine(targetLine) {
      if (!lines.length) return null;
      let closest = lines[0];
      for (const item of lines) {
        if (Math.abs(item.line - targetLine) < Math.abs(closest.line - targetLine)) {
          closest = item;
        }
      }
      return closest;
    }

    function markActiveLine(line) {
      if (currentActive) {
        currentActive.classList.remove('code-active-line');
      }
      const closest = findClosestLine(line);
      if (closest) {
        closest.el.classList.add('code-active-line');
        currentActive = closest.el;
        window.scrollTo({ top: closest.top, behavior: 'smooth' });
      }
    }

    document.addEventListener('toggle', (event) => {
      if (event.target.tagName === 'DETAILS') {
        gatherLineElements();
      }
    }, true);

    window.addEventListener('message', (event) => {
      const { command, line } = event.data;
      if (command === 'syncScroll') {
        markActiveLine(line);
      }
    });

    window.addEventListener('scroll', () => {
      if (!lines.length) return;
      const offset = window.scrollY + (window.innerHeight / 2);
      let low = 0, high = lines.length - 1, best = lines[0];
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const current = lines[mid];
        if (current.top <= offset) {
          best = current;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      vscode.postMessage({ command: 'previewScrolled', line: best.line });
    });

    gatherLineElements();
  </script>
</body>
</html>`;
}
