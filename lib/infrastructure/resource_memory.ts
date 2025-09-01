// src/infrastructure/resource_memory.ts  (for unit/e2e tests)
import type { Resource } from "../application/build_docset_ast.ts";

export function resourceMemory(files: Record<string,string>): Resource {
  const resolve = (base: string, target: string) => {
    try { new URL(target); return target; } catch {}
    const baseDir = base.replace(/\\/g,"/").split("/").slice(0,-1).join("/");
    return normalize(`${baseDir}/${target}`);
  };
  return {
    async readText(p) {
      const k = normalize(resolve("", p));
      if (!(k in files)) throw new Error(`ENOENT: ${k}`);
      return files[k];
    },
    resolve,
    async exists(p) { return normalize(resolve("", p)) in files; }
  };
}
const normalize = (p: string) => {
  const parts = p.split("/"); const out: string[] = [];
  for (const seg of parts) { if (!seg || seg === ".") continue; if (seg === "..") out.pop(); else out.push(seg); }
  return out.join("/");
};
