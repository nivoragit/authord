import { resolveMarkdownOrder, OrderingResolver } from "../lib/order/ordering-resolver.ts";
import * as path from "node:path";
import { asPath } from "../lib/utils/types.ts";

Deno.test("Writerside mode: uses writerside order and appends alpha-sorted orphans", async () => {
  const root = await Deno.makeTempDir({ prefix: "authord-ws-mode-" });
  try {
    const mdDir = root;

    // Prepare files referenced by writerside
    const files = [
      "docs/start.md",
      "docs/intro.md",
      "docs/guide.md",
      "docs/ref.md",
    ];
    await Deno.mkdir(path.resolve(root, "docs"), { recursive: true });
    for (const f of files) {
      await Deno.writeTextFile(path.resolve(root, f), `# ${f}`);
    }

    // Orphans not referenced by writerside
    const orphans = ["docs/a.md", "docs/z.md", "docs/nested/beta.md"];
    await Deno.mkdir(path.resolve(root, "docs/nested"), { recursive: true });
    for (const f of orphans) {
      await Deno.writeTextFile(path.resolve(root, f), `# ${f}`);
    }

    // writerside.cfg
    const writersideCfg = `
      <writerside>
        <instances>
          <instance start-page="docs/start.md" />
        </instances>
        <trees>
          <tree file="docs.tree" />
        </trees>
      </writerside>
    `;
    await Deno.writeTextFile(path.resolve(root, "writerside.cfg"), writersideCfg);

    // docs.tree
    const tree = `
      <toc>
        <toc-element topic="docs/intro.md">
          <toc-element topic="docs/guide.md"/>
        </toc-element>
        <toc-element topic="docs/ref.md"/>
      </toc>
    `;
    await Deno.writeTextFile(path.resolve(root, "docs.tree"), tree);

    const result = await resolveMarkdownOrder(root, mdDir);

    const expectedPrimary = files.map((f) => path.resolve(root, f));
    const expectedOrphans = [...orphans]
      .map((f) => path.resolve(root, f))
      .sort((a, b) =>
        path.relative(mdDir, a).localeCompare(path.relative(mdDir, b)),
      );
    const expected = [...expectedPrimary, ...expectedOrphans];

    if (JSON.stringify(result) !== JSON.stringify(expected)) {
      console.error("Expected:", expected);
      console.error("Got     :", result);
      throw new Error("Order mismatch (writerside mode).");
    }
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test("Authord mode: falls back to authord config and appends orphans", async () => {
  const root = await Deno.makeTempDir({ prefix: "authord-au-mode-" });
  try {
    const mdDir = root;

    await Deno.mkdir(path.resolve(root, "docs/nested"), { recursive: true });

    const primary = [
      "docs/start.md",
      "docs/intro.md",
      "docs/guide.md",
      "docs/ref.md",
    ];
    for (const f of primary) {
      await Deno.writeTextFile(path.resolve(root, f), `# ${f}`);
    }

    const orphans = ["docs/a.md", "docs/nested/zeta.md"];
    for (const f of orphans) {
      await Deno.writeTextFile(path.resolve(root, f), `# ${f}`);
    }

    const authordCfg = {
      instances: [
        {
          "start-page": "docs/start.md",
          toc: {
            "toc-element": [
              {
                topic: "docs/intro.md",
                "toc-element": [{ topic: "docs/guide.md" }],
              },
              { topic: "docs/ref.md" }
            ]
          }
        }
      ]
    };
    await Deno.writeTextFile(
      path.resolve(root, "authord.config.json"),
      JSON.stringify(authordCfg, null, 2),
    );

    const result = await resolveMarkdownOrder(root, mdDir);

    const expectedPrimary = primary.map((f) => path.resolve(root, f));
    const expectedOrphans = [...orphans]
      .map((f) => path.resolve(root, f))
      .sort((a, b) =>
        path.relative(mdDir, a).localeCompare(path.relative(mdDir, b)),
      );
    const expected = [...expectedPrimary, ...expectedOrphans];

    if (JSON.stringify(result) !== JSON.stringify(expected)) {
      console.error("Expected:", expected);
      console.error("Got     :", result);
      throw new Error("Order mismatch (authord mode).");
    }
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test("Alphabetical fallback: no configs, recursive scan alpha-sorted", async () => {
  const root = await Deno.makeTempDir({ prefix: "authord-alpha-mode-" });
  try {
    const mdDir = root;

    await Deno.mkdir(path.resolve(root, "docs/sub"), { recursive: true });

    const created = [
      "docs/a.md",
      "docs/b.md",
      "docs/sub/c.md",
      "docs/sub/A.md", // ensure case-insensitive extension handling and sort
    ];
    for (const f of created) {
      await Deno.writeTextFile(path.resolve(root, f), `# ${f}`);
    }

    // Noise files should be ignored
    await Deno.writeTextFile(path.resolve(root, "docs/ignore.txt"), "skip");
    await Deno.writeTextFile(path.resolve(root, "README.MD"), "# not in mdDir scope");

    const result = await resolveMarkdownOrder(root, mdDir);

    // Only files under mdDir (root) with .md extension should appear, sorted by relative path
    const expected = [...created]
      .map((f) => path.resolve(root, f))
      .sort((a, b) =>
        path.relative(mdDir, a).localeCompare(path.relative(mdDir, b)),
      );

    if (JSON.stringify(result) !== JSON.stringify(expected)) {
      console.error("Expected:", expected);
      console.error("Got     :", result);
      throw new Error("Order mismatch (alphabetical fallback).");
    }
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test("OrderingResolver port: default mdDir === rootDir behavior", async () => {
  const root = await Deno.makeTempDir({ prefix: "authord-port-" });
  try {
    // Simple alpha-only case
    await Deno.mkdir(path.resolve(root, "x"), { recursive: true });
    const f1 = path.resolve(root, "a.md");
    const f2 = path.resolve(root, "x/b.md");
    await Deno.writeTextFile(f1, "# a");
    await Deno.writeTextFile(f2, "# b");

    const resolver = new OrderingResolver();
    const got = await resolver.resolve(asPath(root));
    const gotStr = got.map((p) => p as unknown as string);

    const expected = [f1, f2].sort((a, b) =>
      path.relative(root, a).localeCompare(path.relative(root, b)),
    );

    if (JSON.stringify(gotStr) !== JSON.stringify(expected)) {
      console.error("Expected:", expected);
      console.error("Got     :", gotStr);
      throw new Error("OrderingResolver result mismatch.");
    }
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});
