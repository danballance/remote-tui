import assert from "node:assert/strict";
import test from "node:test";

import type { ConfigContext } from "expo/config";

import configureExpo from "../app.config.js";

test("embeds only the mobile-safe projection while retaining static Expo config", () => {
  const context = {
    projectRoot: "/workspace/apps/mobile",
    staticConfigPath: "/workspace/apps/mobile/app.json",
    packageJsonPath: "/workspace/apps/mobile/package.json",
    config: {
      name: "Remote Deck",
      slug: "remote-deck",
      orientation: "landscape" as const,
      extra: { retained: true },
    },
  } satisfies ConfigContext;

  const expoConfig = configureExpo(context);
  assert.equal(expoConfig.orientation, "landscape");
  assert.equal(expoConfig.extra?.retained, true);
  assert.deepEqual(expoConfig.extra?.remoteDeck, {
    agentUrl: "http://192.168.86.75:43820",
    refreshDelayMs: 100,
    terminal: {
      columns: 120,
      rows: 35,
      fontSize: 9,
      maxFittedFontSize: 48,
    },
  });

  const serialized = JSON.stringify(expoConfig.extra?.remoteDeck);
  assert.equal(serialized.includes("projectStorePath"), false);
  assert.equal(serialized.includes("applicationCatalogPath"), false);
  assert.equal(serialized.includes("sessionPrefix"), false);
});

test("requires the static Expo identity fields", () => {
  assert.throws(
    () =>
      configureExpo({
        projectRoot: "/workspace/apps/mobile",
        staticConfigPath: null,
        packageJsonPath: null,
        config: {},
      }),
    /static Expo config must define name and slug/,
  );
});
