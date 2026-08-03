import assert from "node:assert/strict";
import test from "node:test";

import { parseMobileConfig } from "../src/mobile.js";

const valid = {
  agentUrl: "https://deck.example.test:8443",
  refreshDelayMs: 25,
  terminal: {
    columns: 132,
    rows: 41,
    fontSize: 10,
    maxFittedFontSize: 36,
  },
};

test("validates a complete mobile-safe config without changing it", () => {
  assert.deepEqual(parseMobileConfig(valid), valid);
});

test("rejects invalid roots, unknown fields, and URLs", () => {
  assert.throws(() => parseMobileConfig(null), /\$mobileConfig must be an object/);
  assert.throws(
    () => parseMobileConfig({ ...valid, privatePath: "/private" }),
    /\$mobileConfig\.privatePath is not a supported field/,
  );
  assert.throws(
    () => parseMobileConfig({ ...valid, agentUrl: 42 }),
    /agentUrl must be a string/,
  );
  assert.throws(
    () => parseMobileConfig({ ...valid, agentUrl: " " }),
    /agentUrl must not be blank/,
  );
  assert.throws(
    () => parseMobileConfig({ ...valid, agentUrl: "not a URL" }),
    /agentUrl must be a valid HTTP URL/,
  );
  assert.throws(
    () => parseMobileConfig({ ...valid, agentUrl: "ftp://deck.example.test" }),
    /agentUrl must use the http or https protocol/,
  );
});

test("rejects invalid terminal shapes and numeric settings", () => {
  assert.throws(
    () => parseMobileConfig({ ...valid, terminal: [] }),
    /terminal must be an object/,
  );
  assert.throws(
    () =>
      parseMobileConfig({
        ...valid,
        terminal: { ...valid.terminal, typo: true },
      }),
    /terminal\.typo is not a supported field/,
  );
  assert.throws(
    () => parseMobileConfig({ ...valid, refreshDelayMs: -1 }),
    /refreshDelayMs must be an integer greater than or equal to 0/,
  );
  assert.throws(
    () =>
      parseMobileConfig({
        ...valid,
        terminal: { ...valid.terminal, columns: "132" },
      }),
    /columns must be an integer greater than or equal to 1/,
  );
  assert.throws(
    () =>
      parseMobileConfig({
        ...valid,
        terminal: { ...valid.terminal, fontSize: 37, maxFittedFontSize: 36 },
      }),
    /maxFittedFontSize must be greater than or equal to.*fontSize/,
  );
});
