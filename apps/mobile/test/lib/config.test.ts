import assert from "node:assert/strict";
import test from "node:test";

import { getMobileConfig, readMobileConfig } from "../../lib/config.js";

const embeddedConfig = {
  agentUrl: "http://127.0.0.9:4567",
  refreshDelayMs: 17,
  terminal: {
    columns: 99,
    rows: 31,
    fontSize: 10,
    maxFittedFontSize: 40,
  },
};

test("reads and caches the validated Expo configuration", () => {
  assert.deepEqual(getMobileConfig(), embeddedConfig);
  assert.equal(getMobileConfig(), getMobileConfig());
  assert.deepEqual(readMobileConfig({ remoteDeck: embeddedConfig }), embeddedConfig);
});

test("rejects missing and malformed embedded configuration", () => {
  assert.throws(() => readMobileConfig(undefined), /extra\.remoteDeck is missing/);
  assert.throws(() => readMobileConfig({}), /extra\.remoteDeck is missing/);
  assert.throws(
    () => readMobileConfig({ remoteDeck: { ...embeddedConfig, agentUrl: "wrong" } }),
    /extra\.remoteDeck is invalid:.*agentUrl must be a valid HTTP URL/,
  );
});
