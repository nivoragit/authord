// utils/env.ts
export const getEnv = (k: string): string | undefined =>
  // Prefer Deno
  (typeof Deno !== "undefined" && "env" in Deno ? Deno.env.get(k) : undefined) ??
  // Fallback Node
  (globalThis as any)?.process?.env?.[k];

export const exit = (code = 0): never => {
  if (typeof Deno !== "undefined" && "exit" in Deno) (Deno as any).exit(code);
  (globalThis as any)?.process?.exit?.(code);
  throw new Error(`Exited with code ${code}`);
};
