import { FileReader } from "../ports/file_reader.ts";

function isHttp(u: string) { return /^https?:\/\//i.test(u); }

export class DenoFileReader implements FileReader {
  async readText(pathOrUrl: string): Promise<string> {
    if (isHttp(pathOrUrl)) {
      const res = await fetch(pathOrUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${pathOrUrl}`);
      return await res.text();
    }
    return await Deno.readTextFile(pathOrUrl);
  }

  resolve(base: string, target: string): string {
    if (isHttp(target)) return target;
    try { // base might be URL
      const u = new URL(target, new URL(base, "file:///"));
      return u.protocol === "file:" ? u.pathname : u.toString();
    } catch {
      // file path join
      const baseDir = base.replace(/\\/g, "/").split("/").slice(0, -1).join("/") || ".";
      const joined = (baseDir + "/" + target).split("/").reduce<string[]>((acc, seg) => {
        if (!seg || seg === ".") return acc;
        if (seg === "..") acc.pop(); else acc.push(seg);
        return acc;
      }, []).join("/");
      return joined.startsWith("/") ? joined : joined;
    }
  }

  async exists(pathOrUrl: string): Promise<boolean> {
    if (isHttp(pathOrUrl)) {
      try { const res = await fetch(pathOrUrl, { method: "HEAD" }); return res.ok; } catch { return false; }
    }
    try { await Deno.stat(pathOrUrl); return true; } catch { return false; }
  }
}
