// topic_parser_test.ts
import { assertRejects } from "jsr:@std/assert@^1.0.0";
import { withSchemaFetch, TOPIC_XSD_URL, TOPIC_XSD, TOPIC_XML } from "../test_utils.ts";
import { TopicParser } from "../../lib/core/domain/parse/topic_parser.ts";

Deno.test("topic parser accepts valid topic", async () => {
  await withSchemaFetch({ [TOPIC_XSD_URL]: TOPIC_XSD }, async () => {
    await new TopicParser().parse(TOPIC_XML);
  });
});

Deno.test("topic parser rejects missing xsi:noNamespaceSchemaLocation", async () => {
  const bad = TOPIC_XML.replace(/xsi:noNamespaceSchemaLocation="[^"]+"\s*/g, "");
  await withSchemaFetch({ [TOPIC_XSD_URL]: TOPIC_XSD }, async () => {
    await assertRejects(() => new TopicParser().parse(bad));
  });
});

Deno.test("topic parser rejects unknown child under <topic>", async () => {
  const bad = TOPIC_XML.replace("</topic>", "  <unknown/>\n</topic>");
  await withSchemaFetch({ [TOPIC_XSD_URL]: TOPIC_XSD }, async () => {
    await assertRejects(() => new TopicParser().parse(bad));
  });
});

Deno.test("topic parser rejects missing required <title>", async () => {
  const bad = TOPIC_XML.replace(/<title>[\s\S]*?<\/title>\s*/g, "");
  await withSchemaFetch({ [TOPIC_XSD_URL]: TOPIC_XSD }, async () => {
    await assertRejects(() => new TopicParser().parse(bad));
  });
});

Deno.test("topic parser rejects character data directly in <body> (non-mixed)", async () => {
  const bad = TOPIC_XML.replace("<body>", "<body>text");
  await withSchemaFetch({ [TOPIC_XSD_URL]: TOPIC_XSD }, async () => {
    await assertRejects(() => new TopicParser().parse(bad));
  });
});

Deno.test("topic parser rejects non-allowed child element inside <p>", async () => {
  const bad = TOPIC_XML.replace("<p>Text</p>", "<p><b>no</b></p>");
  await withSchemaFetch({ [TOPIC_XSD_URL]: TOPIC_XSD }, async () => {
    await assertRejects(() => new TopicParser().parse(bad));
  });
});
