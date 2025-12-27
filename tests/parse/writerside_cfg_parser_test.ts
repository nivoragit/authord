// writerside_cfg_parser_test.ts
import { assertEquals, assertRejects } from "jsr:@std/assert@^1.0.0";

import { withSchemaFetch, CFG_XSD_URL, CFG_XSD, CFG_XML } from "../test_utils.ts";
import { WritersideCfgParser } from "../../lib/domain/parse/cfg_parser.ts";

Deno.test("cfg parser accepts valid cfg and projects IR", async () => {
  await withSchemaFetch({ [CFG_XSD_URL]: CFG_XSD }, async () => {
    const ir = await new WritersideCfgParser().parse(CFG_XML);

    assertEquals(ir.topicsDir, "topics");
    assertEquals(ir.imagesDir.dir, "images");
    assertEquals(ir.imagesDir.webPath, "images");
    assertEquals(ir.instances.length, 1);
    assertEquals(ir.instances[0].src, "as.tree");
  });
});

Deno.test("cfg parser rejects missing xsi:noNamespaceSchemaLocation", async () => {
  const bad = CFG_XML.replace(/xsi:noNamespaceSchemaLocation="[^"]+"\s*/g, "");
  await withSchemaFetch({ [CFG_XSD_URL]: CFG_XSD }, async () => {
    await assertRejects(() => new WritersideCfgParser().parse(bad));
  });
});

Deno.test("cfg parser rejects root mismatch before schema fetch", async () => {
  const bad = CFG_XML.replace("<ihp", "<not-ihp");
  await withSchemaFetch({ [CFG_XSD_URL]: CFG_XSD }, async () => {
    await assertRejects(() => new WritersideCfgParser().parse(bad));
  });
});

Deno.test("cfg parser rejects unknown top-level child", async () => {
  const bad = CFG_XML.replace("</ihp>", "  <unknown/>\n</ihp>");
  await withSchemaFetch({ [CFG_XSD_URL]: CFG_XSD }, async () => {
    await assertRejects(() => new WritersideCfgParser().parse(bad));
  });
});

Deno.test("cfg parser rejects unknown attribute (no anyAttribute on ihp)", async () => {
  const bad = CFG_XML.replace("version=\"2.0\"", "version=\"2.0\" extra=\"nope\"");
  await withSchemaFetch({ [CFG_XSD_URL]: CFG_XSD }, async () => {
    await assertRejects(() => new WritersideCfgParser().parse(bad));
  });
});

Deno.test("cfg parser rejects missing required ihp@version", async () => {
  const bad = CFG_XML.replace(/\sversion="2\.0"\s*/g, " ");
  await withSchemaFetch({ [CFG_XSD_URL]: CFG_XSD }, async () => {
    await assertRejects(() => new WritersideCfgParser().parse(bad));
  });
});

Deno.test("cfg parser rejects missing required topics@dir", async () => {
  const bad = CFG_XML.replace("<topics dir=\"topics\"/>", "<topics/>");
  await withSchemaFetch({ [CFG_XSD_URL]: CFG_XSD }, async () => {
    await assertRejects(() => new WritersideCfgParser().parse(bad));
  });
});

Deno.test("cfg parser rejects wrong element order (instance before topics)", async () => {
  const bad = CFG_XML
    .replace(/<topics[\s\S]*?<\/topics>\s*/g, "")
    .replace(
      "<instance id=\"i1\" src=\"as.tree\" keymaps-mode=\"none\" fixed-flag=\"yes\"/>",
      "<instance id=\"i1\" src=\"as.tree\" keymaps-mode=\"none\" fixed-flag=\"yes\"/>\n  <topics dir=\"topics\"/>",
    );
  await withSchemaFetch({ [CFG_XSD_URL]: CFG_XSD }, async () => {
    await assertRejects(() => new WritersideCfgParser().parse(bad));
  });
});

Deno.test("cfg parser rejects missing required attributeGroup id on instance", async () => {
  const bad = CFG_XML.replace("instance id=\"i1\"", "instance");
  await withSchemaFetch({ [CFG_XSD_URL]: CFG_XSD }, async () => {
    await assertRejects(() => new WritersideCfgParser().parse(bad));
  });
});

Deno.test("cfg parser rejects invalid enum value on instance@keymaps-mode", async () => {
  const bad = CFG_XML.replace("keymaps-mode=\"none\"", "keymaps-mode=\"bad\"");
  await withSchemaFetch({ [CFG_XSD_URL]: CFG_XSD }, async () => {
    await assertRejects(() => new WritersideCfgParser().parse(bad));
  });
});

Deno.test("cfg parser rejects fixed attribute mismatch instance@fixed-flag", async () => {
  const bad = CFG_XML.replace("fixed-flag=\"yes\"", "fixed-flag=\"no\"");
  await withSchemaFetch({ [CFG_XSD_URL]: CFG_XSD }, async () => {
    await assertRejects(() => new WritersideCfgParser().parse(bad));
  });
});

Deno.test("cfg parser rejects unknown attribute on instance", async () => {
  const bad = CFG_XML.replace(
    "fixed-flag=\"yes\"",
    "fixed-flag=\"yes\" unknownAttr=\"x\"",
  );
  await withSchemaFetch({ [CFG_XSD_URL]: CFG_XSD }, async () => {
    await assertRejects(() => new WritersideCfgParser().parse(bad));
  });
});

Deno.test("cfg parser allows anyAttribute on resources", async () => {
  const ok = CFG_XML.replace("resources extra=\"ok\"", "resources extra=\"ok\" foo=\"bar\"");
  await withSchemaFetch({ [CFG_XSD_URL]: CFG_XSD }, async () => {
    await new WritersideCfgParser().parse(ok);
  });
});

Deno.test("cfg parser rejects character data in non-mixed element (ihp)", async () => {
  const bad = CFG_XML.replace("<topics dir=\"topics\"/>", "<topics dir=\"topics\"/>text");
  await withSchemaFetch({ [CFG_XSD_URL]: CFG_XSD }, async () => {
    await assertRejects(() => new WritersideCfgParser().parse(bad));
  });
});

Deno.test("cfg parser accepts xs:all children in any order inside settings", async () => {
  const ok = CFG_XML.replace(
    "<settings>\n    <build-config/>\n    <caps for=\"ui\" style=\"aswritten\"/>\n  </settings>",
    "<settings>\n    <caps for=\"ui\" style=\"aswritten\"/>\n    <build-config/>\n  </settings>",
  );
  await withSchemaFetch({ [CFG_XSD_URL]: CFG_XSD }, async () => {
    await new WritersideCfgParser().parse(ok);
  });
});

Deno.test("cfg parser rejects xs:all duplicate child (two caps)", async () => {
  const bad = CFG_XML.replace(
    "<caps for=\"ui\" style=\"aswritten\"/>",
    "<caps for=\"ui\" style=\"aswritten\"/>\n    <caps for=\"ui\" style=\"aswritten\"/>",
  );
  await withSchemaFetch({ [CFG_XSD_URL]: CFG_XSD }, async () => {
    await assertRejects(() => new WritersideCfgParser().parse(bad));
  });
});

Deno.test("cfg parser rejects exceeding maxOccurs in group (instancesGroup max 2)", async () => {
  // CFG_XML already contains 1 <instance .../>. Add TWO more => total 3, should violate maxOccurs=2.
  const bad = CFG_XML.replace(
    "</ihp>",
    `  <instance id="i2" src="b.tree" keymaps-mode="none" fixed-flag="yes"/>
  <instance id="i3" src="c.tree" keymaps-mode="none" fixed-flag="yes"/>
</ihp>`,
  );

  await withSchemaFetch({ [CFG_XSD_URL]: CFG_XSD }, async () => {
    await assertRejects(() => new WritersideCfgParser().parse(bad));
  });
});

