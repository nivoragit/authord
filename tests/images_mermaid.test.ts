import {
  PNG_MAGIC,
  IMAGE_DIR,
  hashString,
  isPngFileOK,
  makeAttachmentStub,
} from "../lib/utils/images.ts";
import { setCommandRunner, renderMermaidDefinitionToFile } from "../lib/utils/mermaid.ts";
import * as path from "node:path";

async function withDenoOverrides<T>(
  overrides: Record<string, unknown>,
  fn: () => Promise<T> | T,
): Promise<T> {
  const original: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(overrides)) {
    original[key] = (Deno as any)[key];
    (Deno as any)[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      (Deno as any)[key] = value;
    }
  }
}

Deno.test("images: hashString is deterministic and hex length 8", () => {
  const a = hashString("hello");
  const b = hashString("hello");
  const c = hashString("world");
  if (a !== b) throw new Error("hashString not deterministic");
  if (!/^[a-f0-9]{8}$/.test(a)) throw new Error("hashString not 8-hex");
  if (a === c) throw new Error("Different inputs should not collide (basic check)");
});

Deno.test("images: isPngFileOK detects PNG by magic", async () => {
  await withDenoOverrides(
    {
      open: async () => ({
        read: async (buf: Uint8Array) => {
          buf.set(PNG_MAGIC);
          return PNG_MAGIC.length;
        },
        close: () => {},
      }),
    },
    async () => {
      const ok = await isPngFileOK("/virtual/x.png");
      if (!ok) throw new Error("Expected PNG to be OK");
    },
  );
});

Deno.test("images: makeAttachmentStub builds Confluence storage XHTML", () => {
  const s = makeAttachmentStub("assets/logo.png", { width: "100px", height: 200, alt: "Logo" });
  if (!s.includes('<ac:image')) throw new Error("Missing ac:image");
  if (!s.includes('ri:filename="logo.png"')) throw new Error("Missing ri:attachment filename");
  if (!s.includes('ac:width="100"')) throw new Error("Width not normalized");
  if (!s.includes('ac:height="200"')) throw new Error("Height not normalized");
  if (!s.includes('alt="Logo"')) throw new Error("Alt not included");
});

// Deno.test("images: setImageDir overrides default", () => {
//   const prev = IMAGE_DIR;
//   setImageDir("imgs");
//   if (IMAGE_DIR !== "imgs") throw new Error("setImageDir failed");
//   setImageDir(prev);
// });

Deno.test("mermaid: prefers local node_modules/.bin/mmdc", async () => {
  let receivedCmd: string[] | null = null;
  const cwd = "/virtual/project";
  const mmdcPath = path.resolve(cwd, "node_modules/.bin/mmdc");
  const outFile = path.resolve(cwd, "out.png");

  setCommandRunner(async (cmd) => {
    receivedCmd = cmd;
    return { code: 0 };
  });

  await withDenoOverrides(
    {
      makeTempFile: async () => "/virtual/tmp.mmd",
      writeTextFile: async () => {},
      mkdir: async () => {},
      remove: async () => {},
      stat: async (p: string) => {
        if (p === mmdcPath || p === outFile) return { isFile: true };
        throw new Error("ENOENT");
      },
    },
    async () => {
      await renderMermaidDefinitionToFile("graph TD; A-->B;", outFile, { cwd });
    },
  );

  setCommandRunner(null);

  if (!receivedCmd) throw new Error("No command captured");
  const cmd = receivedCmd as string[];
  if (cmd[0] !== mmdcPath) {
    console.error("Command:", cmd);
    throw new Error("Expected local mmdc to be used");
  }
});

Deno.test("mermaid: falls back to `npx -y mmdc` and applies options", async () => {
  let receivedCmd: string[] | null = null;
  const cwd = "/virtual/project";
  const outFile = path.resolve(cwd, "diagram.png");

  setCommandRunner(async (cmd) => {
    receivedCmd = cmd;
    return { code: 0 };
  });

  await withDenoOverrides(
    {
      makeTempFile: async () => "/virtual/tmp.mmd",
      writeTextFile: async () => {},
      mkdir: async () => {},
      remove: async () => {},
      stat: async (p: string) => {
        if (p === outFile) return { isFile: true };
        throw new Error("ENOENT");
      },
    },
    async () => {
      await renderMermaidDefinitionToFile("flowchart LR; X-->Y;", outFile, {
        cwd,
        width: 500,
        height: 300,
      });
    },
  );

  setCommandRunner(null);

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
    throw new Error("Expected width/height flags from options");
  }
});
