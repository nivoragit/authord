import { assertStringIncludes } from "std/assert";
import { renderMixedMarkdownToHtml } from "@authord/render-core/utils/mixed_markdown_renderer.ts";

Deno.test("mixed markdown: markdown + chapter + list", async () => {
  const src = `# Configuration Reference

Intro with **bold** text.

<chapter title="Server Configuration" id="server-config">
  <p>Server and networking configuration.</p>
  <list type="bullet">
    <li><p><code>server.port</code>: HTTP port</p></li>
  </list>
</chapter>`;

  const html = await renderMixedMarkdownToHtml(src);
  assertStringIncludes(html, "<h1>Configuration Reference</h1>");
  assertStringIncludes(html, "<strong>bold</strong>");
  assertStringIncludes(html, `<h2 id="server-config">Server Configuration</h2>`);
  assertStringIncludes(html, "<ul>");
});

Deno.test("mixed markdown: code-block becomes pre/code", async () => {
  const src = `<chapter title="Database">
  <code-block lang="yaml">
spring:
  datasource:
    url: jdbc:postgresql://localhost:5432/product_db
  </code-block>
</chapter>`;

  const html = await renderMixedMarkdownToHtml(src);
  assertStringIncludes(html, `<pre><code class="language-yaml">`);
  assertStringIncludes(html, "spring:");
});

Deno.test("mixed markdown: custom handlers extend syntax", async () => {
  const src = `<badge color="red">Hot</badge>`;
  const html = await renderMixedMarkdownToHtml(src, {
    customHandlers: {
      badge: (el) => {
        const color = String(el.properties?.color ?? "default").toLowerCase();
        el.tagName = "span";
        el.properties = { className: ["badge", `badge-${color}`] };
      },
    },
  });
  assertStringIncludes(html, `<span class="badge badge-red">Hot</span>`);
});
