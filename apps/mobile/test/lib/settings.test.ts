import assert from "node:assert/strict";
import test from "node:test";

import { mobileConfig } from "@remote-deck/config/mobile";

test("uses the source-controlled mobile settings directly", () => {
  assert.equal(mobileConfig.agentUrl, "http://192.168.86.75:43820");
  assert.equal(mobileConfig.refreshDelayMs, 100);
  assert.deepEqual(mobileConfig.terminal, {
    columns: 120,
    rows: 35,
    fontSize: 9,
    maxFittedFontSize: 48,
  });
});
