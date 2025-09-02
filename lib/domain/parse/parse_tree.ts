import { parseXml, asArray } from "../../adapters/xml_fxp.ts";
import type { IRInstance, IRTocItem } from "../model/ir.ts";

export function parseTree(xml: string): IRInstance {
  const doc = parseXml<any>(xml);
  const root = doc?.["instance-profile"];
  if (!root) throw new Error("Invalid .tree: missing <instance-profile>");

  const id = root.id;
  const name = root.name;
  const startPage = root["start-page"];
  const isLibrary = root["is-library"] === "true";

  const parseToc = (el: any): IRTocItem => ({
    title: el["toc-title"],
    topic: el.topic,
    file: el.file,
    children: asArray(el["toc-element"]).map(parseToc),
  });


  const toc = asArray(root["toc-element"]).map(parseToc);
  return { id, name, startPage, isLibrary, toc };
}
