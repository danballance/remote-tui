import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  APPLICATION_CATALOG_PATH,
  loadApplicationCatalog,
  parseApplicationCatalog,
  publicApplication,
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
        { id: "push", label: "Push", sendKeysArgs: ["P"] },
        { id: "pull", label: "Pull", sendKeysArgs: ["p"] },
        { id: "stage", label: "Stage", sendKeysArgs: ["Space"] },
        {
          id: "commit",
          label: "Commit",
          sendKeysArgs: ["c"],
          input: {
            type: "text",
            label: "Commit message",
            placeholder: "Summary of changes",
            required: true,
            maxLength: 256,
          },
          sendKeysAfterInputArgs: ["Enter"],
        },
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

test("projects text input metadata without exposing private action keys", () => {
  const [application] = parseApplicationCatalog(`apps:
  - id: demo
    title: Demo
    command: exec demo
    actions:
      - id: rename
        label: Rename
        sendKeysArgs: [r]
        input:
          type: text
          label: New name
          placeholder: Name
          required: true
          maxLength: 80
        sendKeysAfterInputArgs: [Enter, Down]
`);

  assert.ok(application !== undefined);
  assert.deepEqual(publicApplication(application), {
    id: "demo",
    title: "Demo",
    actions: [
      {
        id: "rename",
        label: "Rename",
        input: {
          type: "text",
          label: "New name",
          placeholder: "Name",
          required: true,
          maxLength: 80,
        },
      },
    ],
  });
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

test("rejects invalid text input definitions and suffix keys", () => {
  assertInvalid(
    catalogWithApp({
      actions: `
      - id: run
        label: Run
        sendKeysArgs: [Enter]
        input: text`,
    }),
    /^\$\.apps\[0\]\.actions\[0\]\.input must be an object$/,
  );
  assertInvalid(
    catalogWithApp({
      actions: `
      - id: run
        label: Run
        sendKeysArgs: [Enter]
        input:
          type: select
          label: Value
          required: true
          maxLength: 20`,
    }),
    /^\$\.apps\[0\]\.actions\[0\]\.input\.type must be "text"$/,
  );
  assertInvalid(
    catalogWithApp({
      actions: `
      - id: run
        label: Run
        sendKeysArgs: [Enter]
        input:
          type: text
          label: ""
          required: true
          maxLength: 20`,
    }),
    /^\$\.apps\[0\]\.actions\[0\]\.input\.label must not be blank$/,
  );
  assertInvalid(
    catalogWithApp({
      actions: `
      - id: run
        label: Run
        sendKeysArgs: [Enter]
        input:
          type: text
          label: Value
          placeholder: " "
          required: true
          maxLength: 20`,
    }),
    /^\$\.apps\[0\]\.actions\[0\]\.input\.placeholder must be a non-blank string/,
  );
  assertInvalid(
    catalogWithApp({
      actions: `
      - id: run
        label: Run
        sendKeysArgs: [Enter]
        input:
          type: text
          label: Value
          required: yes
          maxLength: 20`,
    }),
    /^\$\.apps\[0\]\.actions\[0\]\.input\.required must be a boolean$/,
  );
  for (const maxLength of ["0", "1.5", '"20"']) {
    assertInvalid(
      catalogWithApp({
        actions: `
      - id: run
        label: Run
        sendKeysArgs: [Enter]
        input:
          type: text
          label: Value
          required: true
          maxLength: ${maxLength}`,
      }),
      /^\$\.apps\[0\]\.actions\[0\]\.input\.maxLength must be a positive integer$/,
    );
  }
  assertInvalid(
    catalogWithApp({
      actions: `
      - id: run
        label: Run
        sendKeysArgs: [Enter]
        input:
          type: text
          label: Value
          required: true
          maxLength: 20
          typo: true`,
    }),
    /^\$\.apps\[0\]\.actions\[0\]\.input\.typo is not a supported field$/,
  );
  assertInvalid(
    catalogWithApp({
      actions: `
      - id: run
        label: Run
        sendKeysArgs: [Enter]
        sendKeysAfterInputArgs: [Enter]`,
    }),
    /^\$\.apps\[0\]\.actions\[0\]\.sendKeysAfterInputArgs requires an input definition$/,
  );
  assertInvalid(
    catalogWithApp({
      actions: `
      - id: run
        label: Run
        sendKeysArgs: [Enter]
        input:
          type: text
          label: Value
          required: true
          maxLength: 20
        sendKeysAfterInputArgs: []`,
    }),
    /^\$\.apps\[0\]\.actions\[0\]\.sendKeysAfterInputArgs must be a non-empty array/,
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
