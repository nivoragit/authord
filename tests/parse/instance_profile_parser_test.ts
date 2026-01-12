// instance_profile_parser_test.ts
import { assertRejects } from "jsr:@std/assert@^1.0.0";
import {
  withSchemaFetch,
  INSTANCE_DTD_URL,
  INSTANCE_DTD,
  INSTANCE_XML,
} from "../test_utils.ts";
import { InstanceProfileParser } from "@authord/render-core/core/domain/parse/instance_profile_parser.ts";

Deno.test("instance-profile parser accepts valid instance-profile", async () => {
  await withSchemaFetch({ [INSTANCE_DTD_URL]: INSTANCE_DTD }, async () => {
    await new InstanceProfileParser().parse(INSTANCE_XML);
  });
});

Deno.test("instance-profile parser rejects missing DOCTYPE", async () => {
  const bad = INSTANCE_XML.replace(/<!DOCTYPE[\s\S]*?>\s*/i, "");
  await withSchemaFetch({ [INSTANCE_DTD_URL]: INSTANCE_DTD }, async () => {
    await assertRejects(() => new InstanceProfileParser().parse(bad));
  });
});

Deno.test("instance-profile parser rejects unknown child", async () => {
  const bad = INSTANCE_XML.replace(
    "</instance-profile>",
    "  <unknown/>\n</instance-profile>",
  );
  await withSchemaFetch({ [INSTANCE_DTD_URL]: INSTANCE_DTD }, async () => {
    await assertRejects(() => new InstanceProfileParser().parse(bad));
  });
});

Deno.test("instance-profile parser rejects unknown attribute", async () => {
  const bad = INSTANCE_XML.replace(
    "<instance-profile version=\"1.0\">",
    "<instance-profile version=\"1.0\" foo=\"bar\">",
  );
  await withSchemaFetch({ [INSTANCE_DTD_URL]: INSTANCE_DTD }, async () => {
    await assertRejects(() => new InstanceProfileParser().parse(bad));
  });
});

Deno.test("instance-profile parser rejects missing required root attribute", async () => {
  // IMPORTANT: remove version from the ROOT ELEMENT, not from <?xml version="1.0"?>
  const bad = INSTANCE_XML.replace(
    "<instance-profile version=\"1.0\">",
    "<instance-profile>",
  );

  await withSchemaFetch({ [INSTANCE_DTD_URL]: INSTANCE_DTD }, async () => {
    await assertRejects(() => new InstanceProfileParser().parse(bad));
  });
});

Deno.test("instance-profile parser rejects missing required attribute on EMPTY element", async () => {
  const bad = INSTANCE_XML.replace("<empty-el requiredAttr=\"x\"/>", "<empty-el/>");
  await withSchemaFetch({ [INSTANCE_DTD_URL]: INSTANCE_DTD }, async () => {
    await assertRejects(() => new InstanceProfileParser().parse(bad));
  });
});

Deno.test("instance-profile parser rejects text inside EMPTY element", async () => {
  const bad = INSTANCE_XML.replace(
    "<empty-el requiredAttr=\"x\"/>",
    "<empty-el requiredAttr=\"x\">hi</empty-el>",
  );
  await withSchemaFetch({ [INSTANCE_DTD_URL]: INSTANCE_DTD }, async () => {
    await assertRejects(() => new InstanceProfileParser().parse(bad));
  });
});

Deno.test("instance-profile parser rejects element child inside (#PCDATA) element", async () => {
  const bad = INSTANCE_XML.replace(
    "<pcdata-only>hello</pcdata-only>",
    "<pcdata-only><b>no</b></pcdata-only>",
  );
  await withSchemaFetch({ [INSTANCE_DTD_URL]: INSTANCE_DTD }, async () => {
    await assertRejects(() => new InstanceProfileParser().parse(bad));
  });
});

Deno.test("instance-profile parser rejects invalid enum attribute value", async () => {
  const bad = INSTANCE_XML.replace("mode=\"a\"", "mode=\"c\"");
  await withSchemaFetch({ [INSTANCE_DTD_URL]: INSTANCE_DTD }, async () => {
    await assertRejects(() => new InstanceProfileParser().parse(bad));
  });
});

Deno.test("instance-profile parser rejects #FIXED attribute mismatch", async () => {
  const bad = INSTANCE_XML.replace("fixed=\"yes\"", "fixed=\"no\"");
  await withSchemaFetch({ [INSTANCE_DTD_URL]: INSTANCE_DTD }, async () => {
    await assertRejects(() => new InstanceProfileParser().parse(bad));
  });
});

Deno.test("instance-profile parser rejects character data in element-only content", async () => {
  const bad = INSTANCE_XML.replace(
    "<elem-only><b>t</b><i>u</i></elem-only>",
    "<elem-only>text<b>t</b><i>u</i></elem-only>",
  );
  await withSchemaFetch({ [INSTANCE_DTD_URL]: INSTANCE_DTD }, async () => {
    await assertRejects(() => new InstanceProfileParser().parse(bad));
  });
});

Deno.test("instance-profile parser rejects invalid choice (two children)", async () => {
  const bad = INSTANCE_XML.replace(
    "<choices><a/></choices>",
    "<choices><a/><bchild/></choices>",
  );
  await withSchemaFetch({ [INSTANCE_DTD_URL]: INSTANCE_DTD }, async () => {
    await assertRejects(() => new InstanceProfileParser().parse(bad));
  });
});

Deno.test("instance-profile parser rejects missing repeating+ (cardinality)", async () => {
  const bad = INSTANCE_XML.replace(/<repeating>[\s\S]*?<\/repeating>\s*/g, "");
  await withSchemaFetch({ [INSTANCE_DTD_URL]: INSTANCE_DTD }, async () => {
    await assertRejects(() => new InstanceProfileParser().parse(bad));
  });
});

Deno.test("instance-profile parser rejects wrong element order in root sequence", async () => {
  // Swap any-el and pcdata-only positions (root is strict sequence)
  const bad = INSTANCE_XML.replace(
    /<any-el>[\s\S]*?<\/any-el>\s*<pcdata-only>[\s\S]*?<\/pcdata-only>/,
    "<pcdata-only>hello</pcdata-only>\n  <any-el><b>ok</b>text</any-el>",
  );

  await withSchemaFetch({ [INSTANCE_DTD_URL]: INSTANCE_DTD }, async () => {
    await assertRejects(() => new InstanceProfileParser().parse(bad));
  });
});
