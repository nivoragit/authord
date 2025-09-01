import { parseXml } from "../../adapters/xml_fxp.ts";
import type { IRConfig } from "../model/ir.ts";

export function parseCfg(xml: string): IRConfig {
  const doc = parseXml<any>(xml);
  const ihp = doc?.ihp ?? doc?.IHP ?? doc;

  const topicsDir = ihp?.topics?.dir ?? "topics";
  const imagesDir = ihp?.images?.dir ?? "images";
  const imagesWebPath = ihp?.images?.["web-path"];

  const instRaw = ihp?.instance ?? [];
  const instances = (Array.isArray(instRaw) ? instRaw : [instRaw])
    .filter(Boolean)
    .map((i: any) => ({ src: i.src, webPath: i["web-path"] }))
    .filter((i: any) => !!i.src);

  return { topicsDir, imagesDir: { dir: imagesDir, webPath: imagesWebPath }, instances };
}
