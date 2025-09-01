// tests/application/merge_storage_fragments_test.ts
import { assertStringIncludes, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mergeStorageFragments } from "../../lib/application/storage_merge.ts";

Deno.test("mergeStorageFragments: wraps once and preserves content", () => {
  const a = `<div xmlns:ac="http://atlassian.com/content" xmlns:ri="http://atlassian.com/resource/identifier"><p>A</p></div>`;
  const b = `<div xmlns:ac="http://atlassian.com/content" xmlns:ri="http://atlassian.com/resource/identifier"><p>B</p></div>`;
  const merged = mergeStorageFragments([a, b]);
  assertStringIncludes(merged, "<p>A</p>");
  assertStringIncludes(merged, "<p>B</p>");
  const openCount = (merged.match(/<div\b/g) || []).length;
  const closeCount = (merged.match(/<\/div>/g) || []).length;
  assertEquals(openCount, closeCount);
});
