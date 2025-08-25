// import { WritersideMarkdownTransformer } from "../lib/writerside-markdown-transformer.ts";

// Deno.test("images: trailing attrs become Confluence ac:image with width/height", async () => {
//   const md = `![logo](images/logo.png) {width:100px height=200}`;
//   const t = new WritersideMarkdownTransformer();
//   const out = await t.toStorage(md);

//   const s = String(out);
//   if (!s.includes('<ac:image')) throw new Error("Expected <ac:image> element.");
//   if (!s.includes('ri:filename="logo.png"')) throw new Error("Filename not mapped to ri:attachment.");
//   if (!s.includes('ac:width="100"')) throw new Error("Width not normalized to numeric.");
//   if (!s.includes('ac:height="200"')) throw new Error("Height not normalized to numeric.");
// });

// Deno.test("mermaid: fenced block becomes placeholder ac:image with deterministic filename", async () => {
//   const md = "```mermaid\ngraph TD; A-->B;\n```";
//   const t = new WritersideMarkdownTransformer();
//   const out = await t.toStorage(md);

//   const s = String(out);
//   if (!s.includes('<ac:image')) throw new Error("Expected <ac:image> produced for mermaid.");
//   if (!s.includes('ri:filename="mermaid-1.png"')) {
//     console.error("Output:", s);
//     throw new Error("Expected deterministic mermaid placeholder filename.");
//   }
// });

// Deno.test("GFM strike-through and raw HTML passthrough remain", async () => {
//   const md = `~~old~~ and <span class="x">ok</span>`;
//   const t = new WritersideMarkdownTransformer();
//   const out = await t.toStorage(md);

//   const s = String(out);
//   if (!s.includes("<del>old</del>")) {
//     console.error("Output:", s);
//     throw new Error("GFM strike-through not preserved.");
//   }
//   if (!s.includes('<span class="x">ok</span>')) {
//     console.error("Output:", s);
//     throw new Error("Raw HTML not preserved.");
//   }
// });

// Deno.test("basic image without attrs maps to ac:image", async () => {
//   const md = `![Alt](assets/pic.png)`;
//   const t = new WritersideMarkdownTransformer();
//   const out = await t.toStorage(md);
//   const s = String(out);

//   if (!s.includes('ri:filename="pic.png"')) throw new Error("Basename not used for attachment.");
// });
