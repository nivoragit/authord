import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import process from "node:process";

const isDeno =
  typeof (globalThis as any).Deno !== "undefined" &&
  !!(globalThis as any).Deno?.version?.deno;

function resolveLocalBin(binName: string): string | null {
  const suffix = process.platform === "win32" ? ".cmd" : "";
  const local = path.resolve(
    process.cwd(),
    "node_modules",
    ".bin",
    binName + suffix,
  );
  return fs.existsSync(local) ? local : null;
}

export interface MermaidCliOptions {
  width?: number;
  height?: number;
  scale?: number;
  backgroundColor?: string; // e.g. "transparent" or "#fff"
  theme?: string; // "default" | "neutral" | "dark" | "forest" | "base" | etc.
  configFile?: string; // path to mmdc JSON config
  quiet?: boolean; // -q
}

function argsFromOptions(opts: MermaidCliOptions = {}): string[] {
  const out: string[] = [];
  if (opts.quiet !== false) out.push("-q");
  if (opts.width) out.push("-w", String(opts.width));
  if (opts.height) out.push("-H", String(opts.height));
  if (opts.scale) out.push("-s", String(opts.scale));
  if (opts.backgroundColor) out.push("-b", String(opts.backgroundColor));
  if (opts.theme) out.push("-t", String(opts.theme));
  if (opts.configFile) out.push("-c", String(opts.configFile));
  return out;
}

/** Run the mmdc executable with raw args. */
export async function runMermaidCli(args: string[]): Promise<void> {
  const local = resolveLocalBin("mmdc");
  const cmd = local ?? "npx";
  const fullArgs = local ? args : ["-y", "mmdc", ...args];

  if (isDeno) {
    const D = (globalThis as any).Deno as typeof Deno;
    const p = new D.Command(cmd, {
      args: fullArgs,
      stdout: "inherit",
      stderr: "inherit",
    });
    const { code } = await p.output();
    if (code !== 0) throw new Error(`mmdc failed with exit code ${code}`);
  } else {
    const { spawnSync } = await import("node:child_process");
    const res = spawnSync(cmd, fullArgs, { stdio: ["ignore", "inherit", "inherit"] });
    if (res.status !== 0) throw new Error(`mmdc failed with exit code ${res.status ?? -1}`);
  }
}

/**
 * Render a Mermaid definition string to a target file (svg/png/pdf/webp)
 * by writing a temp `.mmd` and invoking mmdc.
 */
export async function renderMermaidDefinitionToFile(
  definition: string,
  outFile: string,
  opts: MermaidCliOptions = {},
): Promise<void> {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "mmd-"));
  const inFile = path.join(tmpDir, "diagram.mmd");
  await fsp.writeFile(inFile, new TextEncoder().encode(definition));

  try {
    const args = ["-i", inFile, "-o", outFile, ...argsFromOptions(opts)];
    await runMermaidCli(args);
  } finally {
    // best-effort cleanup
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
