import assert from "node:assert/strict";
import test from "node:test";

import {
  createApplicationCatalog,
  defaultApplications,
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

test("creates the default typed catalog in source order", () => {
  const catalog = createApplicationCatalog();
  assert.deepEqual(
    catalog.listApplications().map(({ id }) => id),
    ["lazygit", "yazi", "pi"],
  );
  assert.equal(catalog.listApplications(), defaultApplications);
  assert.equal(catalog.getAction("lazygit", "commit")?.label, "Commit");
});
