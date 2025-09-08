import {
  PNG_MAGIC,
  IMAGE_DIR,
  setImageDir,
  hashString,
  isPngFileOK,
  makeAttachmentStub,
} from "../lib/utils/images.ts";
import { setCommandRunner, renderMermaidDefinitionToFile } from "../lib/utils/mermaid.ts";
import * as path from "node:path";

Deno.test("images: hashString is deterministic and hex length 8", () => {
  const a = hashString("hello");
  const b = hashString("hello");
  const c = hashString("world");
  if (a !== b) throw new Error("hashString not deterministic");
  if (!/^[a-f0-9]{8}$/.test(a)) throw new Error("hashString not 8-hex");
  if (a === c) throw new Error("Different inputs should not collide (basic check)");
});

Deno.test("images: isPngFileOK detects PNG by magic", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "authord-png-" });
  try {
    const p = path.resolve(tmpDir, "x.png");
    const f = await Deno.open(p, { write: true, create: true });
    try {
      await f.write(PNG_MAGIC);
      await f.write(new Uint8Array([0, 0, 0, 0])); // pad
    } finally {
      f.close();
    }
    const ok = await isPngFileOK(p);
    if (!ok) throw new Error("Expected PNG to be OK");
  } finally {
    await Deno.remove(tmpDir, { recursive: true }).catch(() => {});
  }
});

Deno.test("images: makeAttachmentStub builds Confluence storage XHTML", () => {
  const s = makeAttachmentStub("assets/logo.png", { width: "100px", height: 200, alt: "Logo" });
  if (!s.includes('<ac:image')) throw new Error("Missing ac:image");
  if (!s.includes('ri:filename="logo.png"')) throw new Error("Missing ri:attachment filename");
  if (!s.includes('ac:width="100"')) throw new Error("Width not normalized");
  if (!s.includes('ac:height="200"')) throw new Error("Height not normalized");
  if (!s.includes('alt="Logo"')) throw new Error("Alt not included");
});

Deno.test("images: setImageDir overrides default", () => {
  const prev = IMAGE_DIR;
  setImageDir("imgs");
  if (IMAGE_DIR !== "imgs") throw new Error("setImageDir failed");
  setImageDir(prev);
});

Deno.test("mermaid: prefers local node_modules/.bin/mmdc", async () => {
  const root = await Deno.makeTempDir({ prefix: "authord-mmdc-local-" });
  const binDir = path.resolve(root, "node_modules/.bin");
  await Deno.mkdir(binDir, { recursive: true });
  const mmdcPath = path.resolve(binDir, "mmdc");
  await Deno.writeTextFile(mmdcPath, "#!/bin/sh\necho local mmdc\n"); // dummy file

  let receivedCmd: string[] | null = null;

  setCommandRunner(async (cmd) => {
    receivedCmd = cmd;
    // simulate success and create the output PNG
    const outIndex = cmd.findIndex((x) => x === "-o");
    const outPath = outIndex >= 0 ? cmd[outIndex + 1] : null;
    if (outPath) {
      const f = await Deno.open(outPath, { write: true, create: true, truncate: true });
      try {
        await f.write(PNG_MAGIC);
      } finally {
        f.close();
      }
    }
    return { code: 0 };
  });

  const outFile = path.resolve(root, "out.png");
  await renderMermaidDefinitionToFile("graph TD; A-->B;", outFile, { cwd: root });

  if (!receivedCmd) throw new Error("No command captured");
  const cmd = receivedCmd as string[];

  if (cmd[0] !== mmdcPath) {
    console.error("Command:", cmd);
    throw new Error("Expected local mmdc to be used");
  }

  // sanity: produced file is a PNG
  const ok = await isPngFileOK(outFile);
  if (!ok) throw new Error("Output file not recognized as PNG");

  // reset runner to default for other tests
  setCommandRunner(null);
  await Deno.remove(root, { recursive: true }).catch(() => {});
});

Deno.test("mermaid: falls back to `npx -y mmdc` and applies env options", async () => {
  const root = await Deno.makeTempDir({ prefix: "authord-mmdc-npx-" });
  let receivedCmd: string[] | null = null;

  // Set env options
  const prevWidth = Deno.env.get("MMD_WIDTH");
  const prevHeight = Deno.env.get("MMD_HEIGHT");
  Deno.env.set("MMD_WIDTH", "500");
  Deno.env.set("MMD_HEIGHT", "300");

  setCommandRunner(async (cmd) => {
    receivedCmd = cmd;
    // simulate success and create output PNG
    const outIndex = cmd.findIndex((x) => x === "-o");
    const outPath = outIndex >= 0 ? cmd[outIndex + 1] : null;
    if (outPath) {
      const f = await Deno.open(outPath, { write: true, create: true, truncate: true });
      try {
        await f.write(PNG_MAGIC);
      } finally {
        f.close();
      }
    }
    return { code: 0 };
  });

  const outFile = path.resolve(root, "diagram.png");
  await renderMermaidDefinitionToFile("flowchart LR; X-->Y;", outFile, { cwd: root });

  if (!receivedCmd) throw new Error("No command captured");
  const cmd = receivedCmd as string[];

  if (cmd[0] !== "npx" || cmd[1] !== "-y" || cmd[2] !== "mmdc") {
    console.error("Command:", cmd);
    throw new Error("Expected npx -y mmdc fallback");
  }
  const hasW = cmd.includes("-w") && cmd.includes("500");
  const hasH = cmd.includes("-H") && cmd.includes("300");
  if (!hasW || !hasH) {
    console.error("Command:", cmd);
    throw new Error("Expected width/height flags from env");
  }

  // cleanup and reset
  if (prevWidth == null) Deno.env.delete("MMD_WIDTH"); else Deno.env.set("MMD_WIDTH", prevWidth);
  if (prevHeight == null) Deno.env.delete("MMD_HEIGHT"); else Deno.env.set("MMD_HEIGHT", prevHeight);
  setCommandRunner(null);
  await Deno.remove(root, { recursive: true }).catch(() => {});
});
