// src/infrastructure/resource_deno.ts
import type { Resource } from "../application/build_docset_ast.ts";

const isHttp = (u: string) => /^https?:\/\//i.test(u);

export const resourceDeno: Resource = {
  async readText(pathOrUrl) {
    if (isHttp(pathOrUrl)) {
      const res = await fetch(pathOrUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${pathOrUrl}`);
      return await res.text();
    }
    return await Deno.readTextFile(pathOrUrl);
  },
  resolve(base, target) {
    if (isHttp(target)) return target;
    try {
      const u = new URL(target, new URL(base, "file:///"));
      return u.protocol === "file:" ? u.pathname : u.toString();
    } catch {
      const baseDir = base.replace(/\\/g,"/").split("/").slice(0,-1).join("/");
      return normalizePath(`${baseDir}/${target}`);
    }
  },
  async exists(pathOrUrl) {
    if (isHttp(pathOrUrl)) {
      try { const res = await fetch(pathOrUrl, { method: "HEAD" }); return res.ok; } catch { return false; }
    }
    try { await Deno.stat(pathOrUrl); return true; } catch { return false; }
  }
};

function normalizePath(p: string) {
  const parts = p.split("/"); const stack: string[] = [];
  for (const seg of parts) {
    if (!seg || seg === ".") continue;
    if (seg === "..") stack.pop(); else stack.push(seg);
  }
  return (p.startsWith("/") ? "/" : "") + stack.join("/");
}
