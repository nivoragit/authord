import {
  readAuthordOrder,
  readWritersideOrder,
} from "../lib/utils/readConfig.ts";
import * as path from "node:path";

Deno.test("readWritersideOrder: happy path with start-page and DFS order", async () => {
  const root = await Deno.makeTempDir({ prefix: "authord-ws-" });
  try {
    const mdDir = root;

    // Files
    const docsDir = path.resolve(root, "docs");
    await Deno.mkdir(docsDir, { recursive: true });

    const files = [
      "docs/start.md",
      "docs/intro.md",
      "docs/guide.md",
      "docs/ref.md",
    ];
    for (const f of files) {
      await Deno.writeTextFile(path.resolve(root, f), `# ${f}`);
    }

    // writerside.cfg referencing docs.tree and including start-page
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

    // docs.tree with toc-elements
    const tree = `
      <toc>
        <toc-element topic="docs/intro.md">
          <toc-element topic="docs/guide.md"/>
        </toc-element>
        <toc-element topic="docs/ref.md"/>
      </toc>
    `;
    await Deno.writeTextFile(path.resolve(root, "docs.tree"), tree);

    const result = await readWritersideOrder(root, mdDir);

    const expected = files.map((f) => path.resolve(root, f));
    if (JSON.stringify(result) !== JSON.stringify(expected)) {
      console.error("Expected:", expected);
      console.error("Got     :", result);
    }
    if (result.length !== expected.length) {
      throw new Error("Incorrect number of files returned.");
    }
    for (let i = 0; i < expected.length; i++) {
      if (result[i] !== expected[i]) {
        throw new Error(`Order mismatch at index ${i}: ${result[i]} !== ${expected[i]}`);
      }
    }
  } finally {
    // Best-effort cleanup
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test("readAuthordOrder: happy path with start-page and DFS order", async () => {
  const root = await Deno.makeTempDir({ prefix: "authord-au-" });
  try {
    const mdDir = root;

    // Files
    const docsDir = path.resolve(root, "docs");
    await Deno.mkdir(docsDir, { recursive: true });
    const files = [
      "docs/start.md",
      "docs/intro.md",
      "docs/guide.md",
      "docs/ref.md",
    ];
    for (const f of files) {
      await Deno.writeTextFile(path.resolve(root, f), `# ${f}`);
    }

    // authord.config.json with instances[*].start-page + toc tree
    const cfg = {
      instances: [
        {
          "start-page": "docs/start.md",
          toc: {
            "toc-element": [
              {
                topic: "docs/intro.md",
                "toc-element": [{ topic: "docs/guide.md" }],
              },
              { topic: "docs/ref.md" },
            ],
          },
        },
      ],
    };
    await Deno.writeTextFile(
      path.resolve(root, "authord.config.json"),
      JSON.stringify(cfg, null, 2),
    );

    const result = await readAuthordOrder(root, mdDir);

    const expected = files.map((f) => path.resolve(root, f));
    if (JSON.stringify(result) !== JSON.stringify(expected)) {
      console.error("Expected:", expected);
      console.error("Got     :", result);
    }
    if (result.length !== expected.length) {
      throw new Error("Incorrect number of files returned.");
    }
    for (let i = 0; i < expected.length; i++) {
      if (result[i] !== expected[i]) {
        throw new Error(`Order mismatch at index ${i}: ${result[i]} !== ${expected[i]}`);
      }
    }
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test("Missing configs: returns empty arrays", async () => {
  const root = await Deno.makeTempDir({ prefix: "authord-missing-" });
  try {
    const mdDir = root;
    const a = await readWritersideOrder(root, mdDir);
    const b = await readAuthordOrder(root, mdDir);
    if (a.length !== 0) throw new Error("Expected empty list for missing writerside.cfg");
    if (b.length !== 0) throw new Error("Expected empty list for missing authord.config.json");
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test("Non-existing topics are ignored", async () => {
  const root = await Deno.makeTempDir({ prefix: "authord-missing-topics-" });
  try {
    const mdDir = root;
    await Deno.writeTextFile(
      path.resolve(root, "authord.config.json"),
      JSON.stringify({
        instances: [
          {
            "start-page": "docs/missing.md",
            toc: {
              "toc-element": [{ topic: "docs/also-missing.md" }],
            },
          },
        ],
      }),
    );

    const res = await readAuthordOrder(root, mdDir);
    if (res.length !== 0) {
      throw new Error("Expected no results when topics do not exist.");
    }
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});
