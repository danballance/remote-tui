import assert from "node:assert/strict";
import test from "node:test";

import {
  executeAppAction,
  InvalidActionRequestError,
  PaneActionQueue,
  parseActionRequestInput,
  type ActionExecutionPhase,
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
    label: "Commit message",
    required: true,
    maxLength: 256,
  },
  sendKeysAfterInputArgs: ["Enter"],
};

function assertInvalidBody(action: AppActionDefinition, body: unknown): void {
  assert.throws(
    () => parseActionRequestInput(action, body),
    (error: unknown) => error instanceof InvalidActionRequestError,
  );
}

test("accepts no body only for immediate actions", () => {
  assert.equal(parseActionRequestInput(immediateAction, undefined), undefined);
  for (const body of [null, {}, { input: "ignored" }, "ignored"]) {
    assertInvalidBody(immediateAction, body);
  }
});

test("trims valid single-line input while preserving literal content", () => {
  const examples = [
    ["  fix: handle Enter; $() '- safely  ", "fix: handle Enter; $() '- safely"],
    ["  – Unicode works 🚀  ", "– Unicode works 🚀"],
    [" -leading-dash ", "-leading-dash"],
  ] as const;

  for (const [raw, expected] of examples) {
    assert.equal(parseActionRequestInput(inputAction, { input: raw }), expected);
  }
  assert.equal(
    parseActionRequestInput(inputAction, { input: "x".repeat(256) }),
    "x".repeat(256),
  );
});

test("rejects malformed, blank, oversized, multiline, and control input", () => {
  for (const body of [
    undefined,
    null,
    {},
    { input: 42 },
    { input: "valid", extra: true },
    { input: "   " },
    { input: "x".repeat(257) },
    { input: "first\nsecond" },
    { input: "first\rsecond" },
    { input: "first\tsecond" },
    { input: `first${String.fromCodePoint(0x7f)}second` },
    { input: `first${String.fromCodePoint(0x85)}second` },
    { input: `first${String.fromCodePoint(0x2028)}second` },
    { input: `first${String.fromCodePoint(0x2029)}second` },
  ]) {
    assertInvalidBody(inputAction, body);
  }
});

test("executes configured keys and sensitive literal text in exact order", async () => {
  const calls: Array<{
    phase: ActionExecutionPhase;
    arguments_: readonly string[];
    literal: boolean;
    sensitive: boolean;
  }> = [];

  await executeAppAction(
    inputAction,
    "fix: handle Enter; safely",
    async (phase, arguments_, options) => {
      calls.push({ phase, arguments_, ...options });
    },
  );

  assert.deepEqual(calls, [
    {
      phase: "before-input",
      arguments_: ["c"],
      literal: false,
      sensitive: false,
    },
    {
      phase: "input",
      arguments_: ["fix: handle Enter; safely"],
      literal: true,
      sensitive: true,
    },
    {
      phase: "after-input",
      arguments_: ["Enter"],
      literal: false,
      sensitive: false,
    },
  ]);
});

test("does not execute any phase when validated input is absent", async () => {
  let called = false;
  await assert.rejects(
    () =>
      executeAppAction(inputAction, undefined, async () => {
        called = true;
      }),
    /Validated action input was not supplied/,
  );
  assert.equal(called, false);
});

test("stops at the first failed action phase", async (context) => {
  const phases: ActionExecutionPhase[] = ["before-input", "input", "after-input"];
  for (const failedPhase of phases) {
    await context.test(failedPhase, async () => {
      const calls: ActionExecutionPhase[] = [];
      await assert.rejects(
        () =>
          executeAppAction(inputAction, "message", async (phase) => {
            calls.push(phase);
            if (phase === failedPhase) {
              throw new Error("phase failed");
            }
          }),
        /phase failed/,
      );
      assert.deepEqual(calls, phases.slice(0, phases.indexOf(failedPhase) + 1));
    });
  }
});

test("serializes operations for one pane while allowing other panes to proceed", async () => {
  const queue = new PaneActionQueue();
  const events: string[] = [];
  let releaseFirst: (() => void) | undefined;
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const first = queue.run("pane-a", async () => {
    events.push("first:start");
    markStarted?.();
    await gate;
    events.push("first:end");
  });
  await started;
  const second = queue.run("pane-a", async () => {
    events.push("second");
  });
  const otherPane = queue.run("pane-b", async () => {
    events.push("other");
  });
  await otherPane;
  assert.deepEqual(events, ["first:start", "other"]);

  releaseFirst?.();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["first:start", "other", "first:end", "second"]);
});

test("continues a pane queue after an earlier operation fails", async () => {
  const queue = new PaneActionQueue();
  const first = queue.run("pane", async () => {
    throw new Error("expected failure");
  });
  const second = queue.run("pane", async () => "completed");

  await assert.rejects(() => first, /expected failure/);
  assert.equal(await second, "completed");
});
