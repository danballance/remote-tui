import assert from "node:assert/strict";
import test from "node:test";

import {
  buildActionCommandPlan,
  InvalidActionRequestError,
  parseActionRequestInput,
} from "../src/actions.js";
import type { AppActionDefinition } from "../src/applications.js";

const immediateAction: AppActionDefinition = {
  id: "up",
  label: "Up",
  sendKeysArgs: ["Up"],
};
const inputAction: AppActionDefinition = {
  id: "commit",
  label: "Commit",
  sendKeysArgs: ["c"],
  input: {
    type: "text",
    label: "Message",
    required: true,
    maxLength: 12,
  },
  sendKeysAfterInputArgs: ["Enter"],
};

test("accepts only the request shape configured for an action", () => {
  assert.equal(parseActionRequestInput(immediateAction, undefined), undefined);
  assert.equal(parseActionRequestInput(inputAction, { input: "  change  " }), "change");

  const cases: readonly [AppActionDefinition, unknown, RegExp][] = [
    [immediateAction, {}, /do not accept/],
    [inputAction, undefined, /require an object body/],
    [inputAction, { input: 4 }, /must be a string/],
    [inputAction, { input: "valid", extra: true }, /extra.*not supported/],
    [inputAction, { input: "more than twelve" }, /must not exceed 12/],
    [inputAction, { input: "line\nbreak" }, /single line/],
    [inputAction, { input: "\u007f" }, /single line/],
    [inputAction, { input: "\u2028" }, /single line/],
    [inputAction, { input: "   " }, /must not be blank/],
  ];
  for (const [action, body, pattern] of cases) {
    assert.throws(
      () => parseActionRequestInput(action, body),
      (error: unknown) =>
        error instanceof InvalidActionRequestError && pattern.test(error.message),
    );
  }
});

test("allows blank text for optional input actions", () => {
  const optionalAction: AppActionDefinition = {
    ...inputAction,
    input: { ...inputAction.input!, required: false },
  };
  assert.equal(parseActionRequestInput(optionalAction, { input: "  " }), "");
});

test("builds immediate and text action command plans in exact order", () => {
  assert.deepEqual(buildActionCommandPlan(immediateAction, undefined), [
    { type: "keys", arguments: ["Up"] },
  ]);
  assert.deepEqual(buildActionCommandPlan(inputAction, "fix"), [
    { type: "keys", arguments: ["c"] },
    { type: "literal", text: "fix" },
    { type: "keys", arguments: ["Enter"] },
  ]);
  assert.deepEqual(buildActionCommandPlan(inputAction, ""), [
    { type: "keys", arguments: ["c"] },
    { type: "keys", arguments: ["Enter"] },
  ]);
});

test("requires validated text before planning an input action", () => {
  assert.throws(
    () => buildActionCommandPlan(inputAction, undefined),
    /Validated action input was not supplied/,
  );
});
