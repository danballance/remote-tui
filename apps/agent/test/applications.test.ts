import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  loadApplicationCatalog,
  publicApplication,
  StaticApplicationCatalog,
  type AppDefinition,
} from "../src/applications.js";

const applications = [
  {
    id: "first",
    title: "First",
    command: "exec first",
    actions: [{ id: "shared", label: "First action", sendKeysArgs: ["f"] }],
  },
  {
    id: "second",
    title: "Second",
    command: "exec second",
    actions: [{ id: "shared", label: "Second action", sendKeysArgs: ["s"] }],
  },
] as const satisfies readonly AppDefinition[];

async function createDefinitionDirectory(
  context: TestContext,
  files: Readonly<Record<string, string>>,
): Promise<URL> {
  const directory = await mkdtemp(join(tmpdir(), "remote-deck-apps-"));
  context.after(async () => await rm(directory, { recursive: true, force: true }));
  await Promise.all(
    Object.entries(files).map(async ([filename, source]) =>
      await writeFile(join(directory, filename), source),
    ),
  );
  return new URL(`${pathToFileURL(directory).href}/`);
}

const validDefinition = `
  export default {
    order: 10,
    id: "valid",
    title: "Valid",
    command: "exec valid",
    actions: [],
  };
`;

test("preserves application order and supports scoped lookups", () => {
  const catalog = new StaticApplicationCatalog(applications);

  assert.deepEqual(catalog.listApplications(), applications);
  assert.equal(catalog.getApplication("second"), applications[1]);
  assert.equal(catalog.getApplication("missing"), undefined);
  assert.equal(catalog.getAction("first", "shared"), applications[0].actions[0]);
  assert.equal(catalog.getAction("second", "shared"), applications[1].actions[0]);
  assert.equal(catalog.getAction("first", "missing"), undefined);
  assert.equal(catalog.getAction("missing", "shared"), undefined);
});

test("projects only client-safe catalog fields", () => {
  const application: AppDefinition = {
    id: "demo",
    title: "Demo",
    command: "exec private-command",
    actions: [
      {
        id: "commit",
        label: "Commit",
        sendKeysArgs: ["private-key"],
        input: {
          type: "text",
          label: "Message",
          placeholder: "Summary",
          required: true,
          maxLength: 80,
        },
        sendKeysAfterInputArgs: ["Enter"],
      },
      { id: "up", label: "Up", sendKeysArgs: ["Up"] },
    ],
  };

  const projected = publicApplication(application);
  assert.deepEqual(projected, {
    id: "demo",
    title: "Demo",
    actions: [
      {
        id: "commit",
        label: "Commit",
        input: {
          type: "text",
          label: "Message",
          placeholder: "Summary",
          required: true,
          maxLength: 80,
        },
      },
      { id: "up", label: "Up" },
    ],
  });
  assert.equal(JSON.stringify(projected).includes("private"), false);
  assert.notEqual(projected.actions[0]?.input, application.actions[0]?.input);
});

test("discovers the built-in typed catalog in configured order", async () => {
  const catalog = await loadApplicationCatalog();
  assert.deepEqual(
    catalog.listApplications().map(({ id }) => id),
    ["lazygit", "yazi", "pi", "package-scripts"],
  );
  assert.deepEqual(
    catalog.getApplication("lazygit")?.actions.map(({ id }) => id),
    ["push", "pull", "stage", "commit", "up", "down"],
  );
  assert.equal(catalog.getAction("lazygit", "commit")?.label, "Commit");
  assert.deepEqual(catalog.getAction("lazygit", "commit")?.input, {
    type: "text",
    label: "Commit message",
    placeholder: "Summary of changes",
    required: true,
    maxLength: 256,
  });
  assert.deepEqual(
    catalog.getApplication("package-scripts")?.actions.map(({ id }) => id),
    ["run", "cancel", "stop", "up", "down"],
  );
  assert.equal(
    catalog.getApplication("package-scripts")?.command,
    "exec nr",
  );
  assert.equal("order" in (catalog.getApplication("lazygit") ?? {}), false);
});

test("discovers files without a registry and sorts by order then ID", async (context) => {
  const directory = await createDefinitionDirectory(context, {
    "later.ts": `export default {
      order: 20, id: "zeta", title: "Zeta", command: "exec zeta", actions: []
    };`,
    "first.ts": `export default {
      order: 10, id: "middle", title: "Middle", command: "exec middle",
      actions: [{ id: "run", label: "Run", sendKeysArgs: ["Enter"] }]
    };`,
    "tie.ts": `export default {
      order: 20, id: "alpha", title: "Alpha", command: "exec alpha", actions: []
    };`,
    "ignored.d.ts": "export {};",
    "ignored.js": "throw new Error('must not be imported');",
    "README.md": "ignored",
  });
  await mkdir(join(fileURLToPath(directory), "nested"));

  const catalog = await loadApplicationCatalog(directory);
  assert.deepEqual(
    catalog.listApplications().map(({ id }) => id),
    ["middle", "alpha", "zeta"],
  );
  assert.equal(catalog.getAction("middle", "run")?.label, "Run");
});

test("rejects invalid discovered module exports", async (context) => {
  const scenarios: readonly {
    readonly name: string;
    readonly source: string;
    readonly pattern: RegExp;
  }[] = [
    {
      name: "missing default export",
      source: "export const application = {};",
      pattern: /missing\.ts.*default export must be an object/,
    },
    {
      name: "non-object default export",
      source: "export default 'invalid';",
      pattern: /invalid\.ts.*default export must be an object/,
    },
    {
      name: "non-finite order",
      source: validDefinition.replace("order: 10", "order: Number.NaN"),
      pattern: /invalid\.ts.*default\.order must be a finite number/,
    },
    {
      name: "unsafe app ID",
      source: validDefinition.replace('id: "valid"', 'id: "Invalid ID"'),
      pattern: /invalid\.ts.*default\.id must start with/,
    },
    {
      name: "missing actions",
      source: validDefinition.replace("actions: []", "actions: null"),
      pattern: /invalid\.ts.*default\.actions must be an array/,
    },
    {
      name: "non-object action",
      source: validDefinition.replace("actions: []", "actions: [null]"),
      pattern: /invalid\.ts.*default\.actions\[0\] must be an object/,
    },
    {
      name: "unsafe action ID",
      source: validDefinition.replace(
        "actions: []",
        'actions: [{ id: "Invalid ID" }]',
      ),
      pattern: /invalid\.ts.*default\.actions\[0\]\.id must start with/,
    },
    {
      name: "duplicate action ID",
      source: validDefinition.replace(
        "actions: []",
        'actions: [{ id: "run" }, { id: "run" }]',
      ),
      pattern: /invalid\.ts.*duplicates action ID "run"/,
    },
  ];

  for (const scenario of scenarios) {
    await context.test(scenario.name, async (subtest) => {
      const filename = scenario.name === "missing default export"
        ? "missing.ts"
        : "invalid.ts";
      const directory = await createDefinitionDirectory(subtest, {
        [filename]: scenario.source,
      });
      await assert.rejects(loadApplicationCatalog(directory), scenario.pattern);
    });
  }
});

test("rejects duplicate app IDs with both filenames", async (context) => {
  const directory = await createDefinitionDirectory(context, {
    "first.ts": validDefinition,
    "second.ts": validDefinition.replace("order: 10", "order: 20"),
  });

  await assert.rejects(
    loadApplicationCatalog(directory),
    /second\.ts.*duplicates application ID "valid" from "first\.ts"/,
  );
});

test("adds filename context to import failures", async (context) => {
  const directory = await createDefinitionDirectory(context, {
    "broken.ts": 'throw new Error("fixture failure"); export default {};',
  });

  await assert.rejects(
    loadApplicationCatalog(directory),
    /Failed to import application definition "broken\.ts"/,
  );
});

test("rejects empty and unreadable definition directories", async (context) => {
  await context.test("empty directory", async (subtest) => {
    const directory = await createDefinitionDirectory(subtest, {
      "README.md": "no definitions",
    });
    await assert.rejects(
      loadApplicationCatalog(directory),
      /No application definitions found/,
    );
  });

  await context.test("unreadable directory", async (subtest) => {
    const directory = await createDefinitionDirectory(subtest, {});
    await assert.rejects(
      loadApplicationCatalog(new URL("missing/", directory)),
      /Failed to read application definitions/,
    );
  });
});
