import { assertEquals } from "std/assert";
import { parseCfg } from "../../lib/domain/parse/parse_cfg.ts";

Deno.test("parseCfg: extracts dirs and instances", () => {
  const xml = `
  <ihp>
    <topics dir="topics"/>
    <images dir="images" web-path="img"/>
    <instance src="a.tree" web-path="/"/>
    <instance src="b.tree"/>
  </ihp>`;
  const cfg = parseCfg(xml);
  assertEquals(cfg.topicsDir, "topics");
  assertEquals(cfg.imagesDir, { dir: "images", webPath: "img" });
  assertEquals(cfg.instances.length, 2);
  assertEquals(cfg.instances[0].src, "a.tree");
});
