import assert from "node:assert/strict";
import test from "node:test";

import { remoteDeckConfig } from "../src/index.js";
import { mobileConfig } from "../src/mobile.js";

test("exports the trusted agent settings", () => {
  assert.deepEqual(remoteDeckConfig.tmux, {
    sessionPrefix: "remote-deck-",
    terminal: { columns: 120, rows: 35 },
  });
  assert.equal(remoteDeckConfig.agent.host, "192.168.86.75");
  assert.equal(remoteDeckConfig.agent.port, 43_820);
  assert.equal(remoteDeckConfig.agent.logLevel, "info");
  assert.match(
    remoteDeckConfig.agent.projectStorePath,
    /apps\/agent\/\.data\/projects\.json$/,
  );
});

test("derives the HTTP-only mobile settings from shared values", () => {
  assert.deepEqual(mobileConfig, {
    agentUrl: "http://192.168.86.75:43820",
    refreshDelayMs: 100,
    terminal: {
      columns: 120,
      rows: 35,
      fontSize: 9,
      maxFittedFontSize: 48,
    },
  });
});
