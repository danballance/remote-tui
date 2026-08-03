import assert from "node:assert/strict";
import test from "node:test";

import type { TmuxConfig } from "@remote-deck/config";

import type { AppActionDefinition, AppDefinition } from "../src/applications.js";
import type { Project } from "../src/projects.js";
import {
  isMissingTmuxTargetError,
  TmuxApplicationRuntime,
  type RuntimeLogger,
  type TmuxExecutor,
} from "../src/runtime.js";

const config: TmuxConfig = {
  sessionPrefix: "test-deck-",
  terminal: { columns: 91, rows: 27 },
};
const project: Project = {
  id: "project-1",
  name: "Remote Deck",
  directory: "/work/remote-deck",
};
const application: AppDefinition = {
  id: "demo",
  title: "Demo",
  command: "exec demo",
  actions: [],
};
const inputAction: AppActionDefinition = {
  id: "commit",
  label: "Commit",
  sendKeysArgs: ["c"],
  input: {
    type: "text",
    label: "Message",
    required: true,
    maxLength: 80,
  },
  sendKeysAfterInputArgs: ["Enter"],
};

class CapturingLogger implements RuntimeLogger {
  readonly entries: { level: string; context: object; message: string }[] = [];

  debug(context: object, message: string): void {
    this.entries.push({ level: "debug", context, message });
  }

  info(context: object, message: string): void {
    this.entries.push({ level: "info", context, message });
  }

  error(context: object, message: string): void {
    this.entries.push({ level: "error", context, message });
  }
}

function missingTarget(message = "can't find pane: demo"): Error {
  return Object.assign(new Error(`tmux failed: ${message}`), {
    stdout: "",
    stderr: message,
  });
}

function harness(
  execute: TmuxExecutor = async () => ({ stdout: "", stderr: "" }),
) {
  const calls: string[][] = [];
  const logger = new CapturingLogger();
  const runtime = new TmuxApplicationRuntime(
    config,
    async (arguments_) => {
      calls.push([...arguments_]);
      return await execute(arguments_);
    },
    logger,
  );
  return { calls, logger, runtime };
}

test("launch reuses an existing exact pane", async () => {
  const { calls, logger, runtime } = harness(async () => ({
    stdout: "%1\n",
    stderr: "",
  }));

  await runtime.launch(project, application);

  assert.deepEqual(calls, [
    ["display-message", "-p", "-t", "=test-deck-project-1:demo.0", "#{pane_id}"],
  ]);
  assert.equal(logger.entries.at(-1)?.message, "reusing existing app window");
});

test("launch creates a window when only the project session exists", async () => {
  let call = 0;
  const { calls, runtime } = harness(async () => {
    call += 1;
    if (call === 1) {
      throw missingTarget();
    }
    return { stdout: "", stderr: "" };
  });

  await runtime.launch(project, application);

  assert.deepEqual(calls, [
    ["display-message", "-p", "-t", "=test-deck-project-1:demo.0", "#{pane_id}"],
    ["has-session", "-t", "=test-deck-project-1"],
    [
      "new-window",
      "-d",
      "-t",
      "=test-deck-project-1",
      "-n",
      "demo",
      "-c",
      "/work/remote-deck",
      "exec demo",
    ],
  ]);
});

test("launch creates the first sized session when no project session exists", async () => {
  let call = 0;
  const { calls, runtime } = harness(async () => {
    call += 1;
    if (call <= 2) {
      throw missingTarget("no such session: test-deck-project-1");
    }
    return { stdout: "", stderr: "" };
  });

  await runtime.launch(project, application);

  assert.deepEqual(calls.at(-1), [
    "new-session",
    "-d",
    "-x",
    "91",
    "-y",
    "27",
    "-s",
    "test-deck-project-1",
    "-n",
    "demo",
    "-c",
    "/work/remote-deck",
    "exec demo",
  ]);
});

test("launch propagates unrelated probe failures", async () => {
  const failure = Object.assign(new Error("permission denied"), {
    stdout: "",
    stderr: "permission denied",
  });
  const { logger, runtime } = harness(async () => {
    throw failure;
  });

  await assert.rejects(() => runtime.launch(project, application), failure);
  assert.equal(logger.entries.at(-1)?.level, "error");
});

test("snapshot captures a running pane without logging its terminal contents", async () => {
  const privateFrame = "\u001b[32mprivate terminal\u001b[0m\n";
  const { calls, logger, runtime } = harness(async (arguments_) =>
    arguments_[0] === "capture-pane"
      ? { stdout: privateFrame, stderr: "" }
      : { stdout: "120\t35\t2\t3\t1\n", stderr: "" },
  );

  assert.deepEqual(await runtime.snapshot(project, application), {
    running: true,
    columns: 120,
    rows: 35,
    ansi: privateFrame.replace(/\n$/, ""),
    cursorX: 2,
    cursorY: 3,
    cursorVisible: true,
  });
  assert.equal(JSON.stringify(logger.entries).includes("private terminal"), false);
  assert.deepEqual(calls[0], [
    "capture-pane",
    "-p",
    "-e",
    "-N",
    "-t",
    "=test-deck-project-1:demo.0",
  ]);
});

test("snapshot maps a missing capture or metadata target to a stopped frame", async () => {
  const stoppedFrame = {
    running: false,
    columns: 91,
    rows: 27,
    ansi: "",
    cursorX: 0,
    cursorY: 0,
    cursorVisible: false,
  };
  const missingCapture = harness(async () => {
    throw missingTarget("no server running on /tmp/tmux-1000/default");
  });
  assert.deepEqual(
    await missingCapture.runtime.snapshot(project, application),
    stoppedFrame,
  );
  assert.equal(missingCapture.calls.length, 1);

  let call = 0;
  const missingMetadata = harness(async () => {
    call += 1;
    if (call === 2) {
      throw missingTarget("can't find window: demo");
    }
    return { stdout: "screen", stderr: "" };
  });
  assert.deepEqual(
    await missingMetadata.runtime.snapshot(project, application),
    stoppedFrame,
  );
});

test("snapshot propagates operational failures and rejects malformed metadata", async () => {
  const failure = Object.assign(new Error("tmux socket denied"), {
    stderr: "permission denied",
  });
  const failed = harness(async () => {
    throw failure;
  });
  await assert.rejects(() => failed.runtime.snapshot(project, application), failure);

  const malformed = harness(async (arguments_) =>
    arguments_[0] === "capture-pane"
      ? { stdout: "screen", stderr: "" }
      : { stdout: "not metadata", stderr: "" },
  );
  await assert.rejects(
    () => malformed.runtime.snapshot(project, application),
    /invalid terminal metadata/,
  );
});

test("runAction executes ordered exact-target commands with literal text", async () => {
  const { calls, runtime } = harness();

  assert.equal(
    await runtime.runAction(project, application, inputAction, "fix: runtime"),
    true,
  );
  assert.deepEqual(calls, [
    ["send-keys", "-t", "=test-deck-project-1:demo.0", "c"],
    [
      "send-keys",
      "-t",
      "=test-deck-project-1:demo.0",
      "-l",
      "--",
      "fix: runtime",
    ],
    ["send-keys", "-t", "=test-deck-project-1:demo.0", "Enter"],
  ]);
});

test("runAction maps missing panes to false and propagates other failures", async () => {
  const missing = harness(async () => {
    throw missingTarget();
  });
  assert.equal(
    await missing.runtime.runAction(project, application, inputAction, "fix"),
    false,
  );

  const failure = new Error("unexpected executor failure");
  const failed = harness(async () => {
    throw failure;
  });
  await assert.rejects(
    () => failed.runtime.runAction(project, application, inputAction, "fix"),
    failure,
  );
});

test("serializes complete action plans for the same pane", async () => {
  const { calls, runtime } = harness(async () => {
    await Promise.resolve();
    return { stdout: "", stderr: "" };
  });

  await Promise.all([
    runtime.runAction(project, application, inputAction, "first"),
    runtime.runAction(project, application, inputAction, "second"),
  ]);

  assert.deepEqual(
    calls.map((arguments_) => arguments_.at(-1)),
    ["c", "first", "Enter", "c", "second", "Enter"],
  );
});

test("recognizes supported missing-target diagnostics only", () => {
  assert.equal(isMissingTmuxTargetError("no such pane: 1"), true);
  assert.equal(isMissingTmuxTargetError(new Error("session not found")), true);
  assert.equal(isMissingTmuxTargetError({ stderr: "window not found" }), true);
  assert.equal(isMissingTmuxTargetError({ message: "permission denied" }), false);
  assert.equal(isMissingTmuxTargetError(null), false);
});
