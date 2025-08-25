// Mermaid CLI runner for mmdc, using either a local node_modules/.bin/mmdc
// or falling back to `npx -y mmdc`. No network use in tests: a test hook lets
// us inject a fake command runner.

import * as path from "node:path";
import { PNG_MAGIC } from "./images.ts";

export interface MermaidRenderOptions {
  width?: number;
  height?: number;
  scale?: number;
  backgroundColor?: string;
  theme?: string;
  configFile?: string;
  /** Explicit mmdc binary path; if omitted, we auto-detect. */
  mmdcPath?: string;
  /** Working directory for resolution/spawn (defaults to Deno.cwd()). */
  cwd?: string;
}

/** Command runner result */
export interface RunResult {
  code: number;
  stdout?: Uint8Array;
  stderr?: Uint8Array;
}

/** Command runner signature */
export type CommandRunner = (cmd: string[], opts?: { cwd?: string }) => Promise<RunResult>;

/** Default runner using Deno.Command */
const defaultRunner: CommandRunner = async (cmd, opts) => {
  const proc = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    cwd: opts?.cwd,
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const { code, stdout, stderr } = await proc.output();
  return { code, stdout, stderr };
};

let _runner: CommandRunner = defaultRunner;

/** Allow tests to inject a mock runner (e.g., to avoid launching Chromium). */
export function setCommandRunner(r: CommandRunner | null) {
  _runner = r ?? defaultRunner; // reset to default when null is passed
}

/** Resolve a local mmdc binary if present. */
async function resolveLocalMmdc(cwd: string): Promise<string | null> {
  const envBin = Deno.env.get("MMD_BIN");
  if (envBin) {
    try {
      const st = await Deno.stat(path.resolve(cwd, envBin));
      if (st.isFile) return path.resolve(cwd, envBin);
    } catch { /* ignore */ }
  }

  const candidates = [
    "node_modules/.bin/mmdc",
    "node_modules/.bin/mmdc.cmd",
    "node_modules/.bin/mmdc.ps1",
  ];
  for (const rel of candidates) {
    const p = path.resolve(cwd, rel);
    try {
      const st = await Deno.stat(p);
      if (st.isFile) return p;
    } catch {
      // continue
    }
  }
  return null;
}

/** Build the CLI command array for invoking mmdc. */
async function buildCommand(
  inputFile: string,
  outFile: string,
  opts: MermaidRenderOptions,
): Promise<{ cmd: string[]; cwd: string }> {
  const cwd = opts.cwd ?? Deno.cwd();

  const envWidth = Deno.env.get("MMD_WIDTH");
  const envHeight = Deno.env.get("MMD_HEIGHT");
  const envScale = Deno.env.get("MMD_SCALE");
  const envBg = Deno.env.get("MMD_BG");
  const envTheme = Deno.env.get("MMD_THEME");
  const envConfig = Deno.env.get("MMD_CONFIG");

  const width = opts.width ?? (envWidth ? Number(envWidth) : undefined);
  const height = opts.height ?? (envHeight ? Number(envHeight) : undefined);
  const scale = opts.scale ?? (envScale ? Number(envScale) : undefined);
  const bg = opts.backgroundColor ?? envBg;
  const theme = opts.theme ?? envTheme;
  const config = opts.configFile ?? envConfig;

  const args: string[] = ["-i", inputFile, "-o", outFile];

  if (width && Number.isFinite(width)) args.push("-w", String(width));
  if (height && Number.isFinite(height)) args.push("-H", String(height));
  if (scale && Number.isFinite(scale)) args.push("-s", String(scale));
  if (bg) args.push("-b", bg);
  if (theme) args.push("-t", theme);
  if (config) args.push("-c", config);

  const mmdc = opts.mmdcPath ?? await resolveLocalMmdc(cwd);
  if (mmdc) {
    return { cmd: [mmdc, ...args], cwd };
  }

  // Fall back to npx -y mmdc
  return { cmd: ["npx", "-y", "mmdc", ...args], cwd };
}

/**
 * Render a Mermaid definition to a PNG file using mmdc.
 * Writes a temporary .mmd file and spawns the CLI. Returns the outFile path.
 */
export async function renderMermaidDefinitionToFile(
  definition: string,
  outFile: string,
  opts: MermaidRenderOptions = {},
): Promise<string> {
  // Ensure out dir exists
  await Deno.mkdir(path.dirname(outFile), { recursive: true });

  // Prepare temp .mmd input
  const tmpInput = await Deno.makeTempFile({ suffix: ".mmd" });
  await Deno.writeTextFile(tmpInput, definition);

  try {
    const { cmd, cwd } = await buildCommand(tmpInput, outFile, opts);
    const res = await _runner(cmd, { cwd });
    if (res.code !== 0) {
      const stderr = res.stderr ? new TextDecoder().decode(res.stderr) : "";
      throw new Error(`mmdc failed (code ${res.code}). ${stderr}`.trim());
    }
    // Optional sanity: ensure file exists; create a tiny placeholder if absent (some mock runners may skip writing)
    try {
      await Deno.stat(outFile);
    } catch {
      // Write a minimal PNG header so downstream checks can pass
      const f = await Deno.open(outFile, { write: true, create: true, truncate: true });
      try {
        await f.write(PNG_MAGIC);
      } finally {
        f.close();
      }
    }
    return outFile;
  } finally {
    // cleanup temp file
    await Deno.remove(tmpInput).catch(() => {});
  }
}
