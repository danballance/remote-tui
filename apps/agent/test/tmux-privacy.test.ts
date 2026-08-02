import assert from "node:assert/strict";
import test from "node:test";

import {
  privateInputLogCommand,
  privateTmuxFailureError,
  privateTmuxFailureStatus,
} from "../src/tmux-privacy.js";

test("sensitive tmux diagnostics omit raw, trimmed, and argv-bearing error text", () => {
  const rawInput = "  secret commit message  ";
  const trimmedInput = rawInput.trim();
  const childError = {
    code: 1,
    killed: false,
    message: `Command failed: tmux send-keys -l -- ${trimmedInput}`,
    cmd: `tmux send-keys -l -- ${trimmedInput}`,
    stderr: rawInput,
  };

  const diagnostics = JSON.stringify({
    command: privateInputLogCommand("session:app.0"),
    failure: privateTmuxFailureStatus(childError),
    replacementError: privateTmuxFailureError(),
  });

  assert.equal(diagnostics.includes(rawInput), false);
  assert.equal(diagnostics.includes(trimmedInput), false);
  assert.match(diagnostics, /\[REDACTED\]/);
  assert.match(diagnostics, /"exitCode":1/);
});
