import { assertEquals } from "std/assert";
import { expandMacros } from "../../lib/domain/macros/expand_macros.ts";

Deno.test("expandMacros: replaces known keys", () => {
  const out = expandMacros("Hello %name%!", { name: "World" });
  assertEquals(out, "Hello World!");
});

Deno.test("expandMacros: leaves unknown intact", () => {
  const out = expandMacros("A %x% B", {});
  assertEquals(out, "A %x% B");
});
