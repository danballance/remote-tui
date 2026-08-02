import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  APPLICATION_CATALOG_PATH,
  loadApplicationCatalog,
  parseApplicationCatalog,
} from "../src/applications.js";

/** Builds the smallest valid app while letting each test isolate one field. */
function catalogWithApp({
  id = "demo",
  title = "Demo",
  command = "exec demo",
  actions = `
      - id: run
        label: Run
        sendKeysArgs: [Enter]`,
  extraField = "",
}: {
  id?: string;
  title?: string;
  command?: string;
  actions?: string;
  extraField?: string;
} = {}): string {
  return `apps:
  - id: ${id}
    title: ${title}
    command: ${command}
    actions:${actions}${extraField}
`;
}

/** Ensures every invalid fixture reports the path that needs correcting. */
function assertInvalid(source: string, expectedMessage: RegExp): void {
  assert.throws(
    () => parseApplicationCatalog(source),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, expectedMessage);
      return true;
    },
  );
}

test("loads the checked-in catalog with private command definitions intact", async () => {
  assert.deepEqual(await loadApplicationCatalog(APPLICATION_CATALOG_PATH), [
    {
      id: "lazygit",
      title: "LazyGit",
      command: "exec lazygit",
      actions: [
        { id: "up", label: "Up", sendKeysArgs: ["Up"] },
        { id: "down", label: "Down", sendKeysArgs: ["Down"] },
      ],
    },
    {
      id: "yazi",
      title: "Yazi",
      command: "exec yazi",
      actions: [
        { id: "up", label: "Up", sendKeysArgs: ["Up"] },
        { id: "down", label: "Down", sendKeysArgs: ["Down"] },
      ],
    },
    {
      id: "pi",
      title: "Pi",
      command: "exec pi",
      actions: [
        { id: "up", label: "Up", sendKeysArgs: ["Up"] },
        { id: "down", label: "Down", sendKeysArgs: ["Down"] },
      ],
    },
  ]);
});

test("preserves app, action, and tmux argument order", () => {
  const applications = parseApplicationCatalog(`apps:
  - id: second
    title: Second
    command: exec second
    actions:
      - id: later
        label: Later
        sendKeysArgs: [-l, hello]
      - id: first
        label: First
        sendKeysArgs: [Escape]
  - id: empty
    title: Empty
    command: exec empty
    actions: []
`);

  assert.deepEqual(applications, [
    {
      id: "second",
      title: "Second",
      command: "exec second",
      actions: [
        { id: "later", label: "Later", sendKeysArgs: ["-l", "hello"] },
        { id: "first", label: "First", sendKeysArgs: ["Escape"] },
      ],
    },
    { id: "empty", title: "Empty", command: "exec empty", actions: [] },
  ]);
});

test("accepts an empty app catalog", () => {
  assert.deepEqual(parseApplicationCatalog("apps: []\n"), []);
});

test("reports both the catalog location and invalid field path", async (context) => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "remote-deck-catalog-"));
  context.after(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  const catalogPath = join(temporaryDirectory, "apps.yaml");
  await writeFile(catalogPath, "apps: wrong\n", "utf8");
  await assert.rejects(
    () => loadApplicationCatalog(catalogPath),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes(catalogPath));
      assert.ok(error.message.includes("$.apps must be an array"));
      return true;
    },
  );
});

test("rejects malformed YAML and invalid root shapes", () => {
  assertInvalid("apps: [\n", /^\$ contains invalid YAML:/);
  assertInvalid("- app\n", /^\$ must be an object$/);
  assertInvalid("apps: wrong\n", /^\$\.apps must be an array$/);
  assertInvalid("apps: []\nunexpected: true\n", /^\$\.unexpected is not a supported field$/);
});

test("rejects invalid application fields", () => {
  assertInvalid(catalogWithApp({ id: '""' }), /^\$\.apps\[0\]\.id must not be blank$/);
  assertInvalid(
    catalogWithApp({ id: "Uppercase" }),
    /^\$\.apps\[0\]\.id must start with a lowercase letter or number/,
  );
  assertInvalid(
    catalogWithApp({ title: '""' }),
    /^\$\.apps\[0\]\.title must not be blank$/,
  );
  assertInvalid(
    catalogWithApp({ command: '" "' }),
    /^\$\.apps\[0\]\.command must not be blank$/,
  );
  assertInvalid(
    catalogWithApp({ actions: " wrong" }),
    /^\$\.apps\[0\]\.actions must be an array$/,
  );
  assertInvalid(
    catalogWithApp({ extraField: "\n    typo: true" }),
    /^\$\.apps\[0\]\.typo is not a supported field$/,
  );
});

test("rejects invalid action fields and arguments", () => {
  assertInvalid(
    catalogWithApp({
      actions: `
      - id: ""
        label: Run
        sendKeysArgs: [Enter]`,
    }),
    /^\$\.apps\[0\]\.actions\[0\]\.id must not be blank$/,
  );
  assertInvalid(
    catalogWithApp({
      actions: `
      - id: bad/action
        label: Run
        sendKeysArgs: [Enter]`,
    }),
    /^\$\.apps\[0\]\.actions\[0\]\.id must start with a lowercase letter or number/,
  );
  assertInvalid(
    catalogWithApp({
      actions: `
      - id: run
        label: ""
        sendKeysArgs: [Enter]`,
    }),
    /^\$\.apps\[0\]\.actions\[0\]\.label must not be blank$/,
  );
  assertInvalid(
    catalogWithApp({
      actions: `
      - id: run
        label: Run`,
    }),
    /^\$\.apps\[0\]\.actions\[0\]\.sendKeysArgs must be a non-empty array/,
  );
  assertInvalid(
    catalogWithApp({
      actions: `
      - id: run
        label: Run
        sendKeysArgs: []`,
    }),
    /^\$\.apps\[0\]\.actions\[0\]\.sendKeysArgs must be a non-empty array/,
  );
  assertInvalid(
    catalogWithApp({
      actions: `
      - id: run
        label: Run
        sendKeysArgs: [42]`,
    }),
    /^\$\.apps\[0\]\.actions\[0\]\.sendKeysArgs\[0\] must be a non-blank string$/,
  );
  assertInvalid(
    catalogWithApp({
      actions: `
      - id: run
        label: Run
        sendKeysArgs: [" "]`,
    }),
    /^\$\.apps\[0\]\.actions\[0\]\.sendKeysArgs\[0\] must be a non-blank string$/,
  );
  assertInvalid(
    catalogWithApp({
      actions: `
      - id: run
        label: Run
        sendKeysArgs: [Enter]
        typo: true`,
    }),
    /^\$\.apps\[0\]\.actions\[0\]\.typo is not a supported field$/,
  );
});

test("rejects duplicate application and scoped action IDs", () => {
  assertInvalid(
    `apps:
  - id: duplicate
    title: First
    command: exec first
    actions: []
  - id: duplicate
    title: Second
    command: exec second
    actions: []
`,
    /^\$\.apps\[1\]\.id duplicates application ID "duplicate"$/,
  );
  assertInvalid(
    catalogWithApp({
      actions: `
      - id: duplicate
        label: First
        sendKeysArgs: [Up]
      - id: duplicate
        label: Second
        sendKeysArgs: [Down]`,
    }),
    /^\$\.apps\[0\]\.actions\[1\]\.id duplicates action ID "duplicate"$/,
  );
});
