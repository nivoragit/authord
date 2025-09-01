// tests/domain/resolve_includes_test.ts
import { assertThrows } from "std/assert";
import { resolveIncludes } from "../../lib/domain/resolve/resolve_includes.ts";
import { TopicPageNode } from "../../lib/domain/model/ast.ts";

Deno.test("includes: detects cycle", () => {
  // a includes b#x
  // b#x includes a#y
  // a#y includes b#x   <-- repeats the original include, closes the loop
  const a: TopicPageNode = {
    type: "topicPage",
    data: { file: "/a.topic", id: "a", title: "a" },
    children: [
      // define a#y that points back to b#x (completes the loop)
      {
        type: "snippetDef",
        data: { id: "y" },
        children: [
          { type: "includeMarker", data: { from: "/b.topic", elementId: "x" }, children: [] },
        ],
      },
      // starting include: a -> b#x
      { type: "includeMarker", data: { from: "/b.topic", elementId: "x" }, children: [] },
    ],
  };

  const b: TopicPageNode = {
    type: "topicPage",
    data: { file: "/b.topic", id: "b", title: "b" },
    children: [
      // b#x points back to a#y
      {
        type: "snippetDef",
        data: { id: "x" },
        children: [
          { type: "includeMarker", data: { from: "/a.topic", elementId: "y" }, children: [] },
        ],
      },
    ],
  };

  const lookup = (_owner: string, from: string) =>
    from === "/a.topic" ? a : from === "/b.topic" ? b : undefined;

  assertThrows(
    () => resolveIncludes(a, lookup),
    Error,
    "Include cycle",
  );
});
