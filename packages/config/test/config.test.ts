import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DEFAULT_CONFIG_PATH,
  environmentName,
  loadConfig,
  parseConfig,
  toMobileConfig,
} from "../src/index.js";

const VALID_SOURCE = `agent:
  protocol: http
  host: 10.0.0.8
  port: 43820
  logLevel: info
  applicationCatalogPath: apps/agent/apps.yaml
  projectStorePath: apps/agent/.data/projects.json
tmux:
  sessionPrefix: remote-deck-
  terminal:
    columns: 120
    rows: 35
mobile:
  refreshDelayMs: 100
  terminal:
    fontSize: 9
    maxFittedFontSize: 48
`;

function parse(source = VALID_SOURCE, environment = {}) {
  return parseConfig(source, {
    configPath: "/workspace/config.yaml",
    environment,
  });
}

test("parses every section and resolves configured paths from the YAML file", () => {
  assert.deepEqual(parse(), {
    agent: {
      protocol: "http",
      host: "10.0.0.8",
      port: 43_820,
      logLevel: "info",
      applicationCatalogPath: "/workspace/apps/agent/apps.yaml",
      projectStorePath: "/workspace/apps/agent/.data/projects.json",
    },
    tmux: {
      sessionPrefix: "remote-deck-",
      terminal: { columns: 120, rows: 35 },
    },
    mobile: {
      refreshDelayMs: 100,
      terminal: { fontSize: 9, maxFittedFontSize: 48 },
    },
  });

  const absolute = parse(
    VALID_SOURCE.replace(
      "apps/agent/apps.yaml",
      "/srv/remote-deck/apps.yaml",
    ),
  );
  assert.equal(absolute.agent.applicationCatalogPath, "/srv/remote-deck/apps.yaml");
});

test("derives stable override names and applies string and integer values", () => {
  assert.equal(
    environmentName(["mobile", "terminal", "maxFittedFontSize"]),
    "REMOTE_DECK_MOBILE_TERMINAL_MAX_FITTED_FONT_SIZE",
  );

  const config = parse(VALID_SOURCE, {
    REMOTE_DECK_AGENT_HOST: "deck.example.test",
    REMOTE_DECK_AGENT_PORT: "8443",
    REMOTE_DECK_AGENT_PROTOCOL: "https",
    REMOTE_DECK_TMUX_TERMINAL_COLUMNS: "144",
    REMOTE_DECK_MOBILE_REFRESH_DELAY_MS: "0",
  });
  assert.equal(config.agent.host, "deck.example.test");
  assert.equal(config.agent.port, 8443);
  assert.equal(config.agent.protocol, "https");
  assert.equal(config.tmux.terminal.columns, 144);
  assert.equal(config.mobile.refreshDelayMs, 0);
});

test("supports the legacy log override while preferring the canonical name", () => {
  assert.equal(
    parse(VALID_SOURCE, { REMOTE_DECK_LOG_LEVEL: "debug" }).agent.logLevel,
    "debug",
  );
  assert.equal(
    parse(VALID_SOURCE, {
      REMOTE_DECK_LOG_LEVEL: "debug",
      REMOTE_DECK_AGENT_LOG_LEVEL: "warn",
    }).agent.logLevel,
    "warn",
  );
});

test("rejects malformed YAML, invalid shapes, unknown fields, and missing leaves", () => {
  assert.throws(() => parse("agent: [\n"), /^Error: \$ contains invalid YAML:/);
  assert.throws(() => parse("- wrong\n"), /\$ must be an object/);
  assert.throws(
    () => parse(VALID_SOURCE.replace("agent:\n", "agent:\n  typo: true\n")),
    /\$\.agent\.typo is not a supported field/,
  );
  assert.throws(
    () => parse(VALID_SOURCE.replace("  host: 10.0.0.8\n", "")),
    /\$\.agent\.host must be a string/,
  );
  assert.throws(
    () =>
      parse(
        VALID_SOURCE.replace(
          "  terminal:\n    columns: 120\n    rows: 35",
          "  terminal: wrong",
        ),
      ),
    /\$\.tmux\.terminal must be an object/,
  );
});

test("rejects blank, unsupported, non-integer, and out-of-range values", () => {
  for (const [environment, expected] of [
    [{ REMOTE_DECK_AGENT_HOST: " " }, /REMOTE_DECK_AGENT_HOST.*must not be blank/],
    [
      { REMOTE_DECK_AGENT_PROTOCOL: "ftp" },
      /REMOTE_DECK_AGENT_PROTOCOL.*must be one of: http, https/,
    ],
    [
      { REMOTE_DECK_AGENT_LOG_LEVEL: "verbose" },
      /REMOTE_DECK_AGENT_LOG_LEVEL.*must be one of:/,
    ],
    [{ REMOTE_DECK_AGENT_PORT: "1.5" }, /REMOTE_DECK_AGENT_PORT.*must be an integer/],
    [
      { REMOTE_DECK_MOBILE_REFRESH_DELAY_MS: "" },
      /REMOTE_DECK_MOBILE_REFRESH_DELAY_MS.*must be an integer/,
    ],
    [
      { REMOTE_DECK_AGENT_PORT: "65536" },
      /REMOTE_DECK_AGENT_PORT.*must be less than or equal to 65535/,
    ],
    [
      { REMOTE_DECK_TMUX_TERMINAL_ROWS: "0" },
      /REMOTE_DECK_TMUX_TERMINAL_ROWS.*must be greater than or equal to 1/,
    ],
  ] as const) {
    assert.throws(() => parse(VALID_SOURCE, environment), expected);
  }

  assert.throws(
    () =>
      parse(
        VALID_SOURCE.replace("maxFittedFontSize: 48", "maxFittedFontSize: 8"),
      ),
    /maxFittedFontSize must be greater than or equal to.*fontSize/,
  );
  assert.throws(
    () => parse(VALID_SOURCE.replace("port: 43820", 'port: "43820"')),
    /\$\.agent\.port must be an integer/,
  );
});

test("loads checked-in and overridden config paths with contextual failures", () => {
  const checkedIn = loadConfig({ environment: {} });
  assert.equal(DEFAULT_CONFIG_PATH.endsWith("/config.yaml"), true);
  assert.equal(checkedIn.agent.port, 43_820);

  const directory = mkdtempSync(join(tmpdir(), "remote-deck-config-"));
  try {
    const environmentPath = join(directory, "environment.yaml");
    const explicitPath = join(directory, "explicit.yaml");
    writeFileSync(environmentPath, VALID_SOURCE.replace("port: 43820", "port: 4100"));
    writeFileSync(explicitPath, VALID_SOURCE.replace("port: 43820", "port: 4200"));

    assert.equal(
      loadConfig({
        environment: { REMOTE_DECK_CONFIG_PATH: environmentPath },
      }).agent.port,
      4100,
    );
    assert.equal(
      loadConfig({
        configPath: explicitPath,
        environment: { REMOTE_DECK_CONFIG_PATH: environmentPath },
      }).agent.port,
      4200,
    );

    writeFileSync(explicitPath, "agent: wrong\n");
    assert.throws(
      () => loadConfig({ configPath: explicitPath, environment: {} }),
      new RegExp(`Invalid Remote Deck config at ${explicitPath.replaceAll("/", "\\/")}`),
    );
    assert.throws(
      () => loadConfig({ configPath: join(directory, "missing.yaml"), environment: {} }),
      /Failed to read Remote Deck config at.*missing\.yaml/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("projects only public connection and rendering settings for mobile", () => {
  const mobile = toMobileConfig(parse());
  assert.deepEqual(mobile, {
    agentUrl: "http://10.0.0.8:43820",
    refreshDelayMs: 100,
    terminal: {
      columns: 120,
      rows: 35,
      fontSize: 9,
      maxFittedFontSize: 48,
    },
  });
  const serialized = JSON.stringify(mobile);
  assert.equal(serialized.includes("projectStorePath"), false);
  assert.equal(serialized.includes("sessionPrefix"), false);
  assert.equal(serialized.includes("apps.yaml"), false);
});
