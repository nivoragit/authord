// import { XMLParser } from "fxp";

// const parser = new XMLParser({
//   ignoreAttributes: false,
//   attributeNamePrefix: "",
//   trimValues: true,
//   allowBooleanAttributes: true,
//   isArray: (name) => ["instance","toc-element","chapter","p","list","li","tr","td","snippet","include","code-block","a","format"].includes(name),
// });

// export function parseXml<T = any>(xml: string): T {
//   return parser.parse(xml) as T;
// }

// export function asArray<T>(x: T | T[] | undefined): T[] {
//   if (x === undefined || x === null) return [];
//   return Array.isArray(x) ? x : [x];
// }
