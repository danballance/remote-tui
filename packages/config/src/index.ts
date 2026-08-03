/** Strict loader for the checked-in Remote Deck YAML configuration. */

import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";

import { parse } from "yaml";

import { parseMobileConfig } from "./mobile.ts";
import type {
  AgentLogLevel,
  AgentProtocol,
  MobileConfig,
  RemoteDeckConfig,
} from "./types.ts";

export type {
  AgentConfig,
  AgentLogLevel,
  AgentProtocol,
  MobileConfig,
  MobileSourceConfig,
  MobileTerminalConfig,
  RemoteDeckConfig,
  TmuxConfig,
  TmuxTerminalConfig,
} from "./types.ts";

/** Default checked-in configuration, independent of the caller's working directory. */
export const DEFAULT_CONFIG_PATH = fileURLToPath(
  new URL("../../../config.yaml", import.meta.url),
);

const LOG_LEVELS = new Set<AgentLogLevel>([
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
  "silent",
]);
const PROTOCOLS = new Set<AgentProtocol>(["http", "https"]);

type ConfigPrimitive = string | number;
type FieldKind = "string" | "integer";

interface FieldSpec {
  readonly path: readonly string[];
  readonly kind: FieldKind;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly allowedValues?: ReadonlySet<string>;
}

const FIELD_SPECS = {
  agentProtocol: {
    path: ["agent", "protocol"],
    kind: "string",
    allowedValues: PROTOCOLS,
  },
  agentHost: { path: ["agent", "host"], kind: "string" },
  agentPort: {
    path: ["agent", "port"],
    kind: "integer",
    minimum: 1,
    maximum: 65_535,
  },
  agentLogLevel: {
    path: ["agent", "logLevel"],
    kind: "string",
    allowedValues: LOG_LEVELS,
  },
  applicationCatalogPath: {
    path: ["agent", "applicationCatalogPath"],
    kind: "string",
  },
  projectStorePath: {
    path: ["agent", "projectStorePath"],
    kind: "string",
  },
  sessionPrefix: { path: ["tmux", "sessionPrefix"], kind: "string" },
  terminalColumns: {
    path: ["tmux", "terminal", "columns"],
    kind: "integer",
    minimum: 1,
  },
  terminalRows: {
    path: ["tmux", "terminal", "rows"],
    kind: "integer",
    minimum: 1,
  },
  refreshDelayMs: {
    path: ["mobile", "refreshDelayMs"],
    kind: "integer",
    minimum: 0,
  },
  fontSize: {
    path: ["mobile", "terminal", "fontSize"],
    kind: "integer",
    minimum: 1,
  },
  maxFittedFontSize: {
    path: ["mobile", "terminal", "maxFittedFontSize"],
    kind: "integer",
    minimum: 1,
  },
} as const satisfies Record<string, FieldSpec>;

type FieldKey = keyof typeof FIELD_SPECS;

export interface ParseConfigOptions {
  /** Path used as the base for resolving relative configured paths. */
  readonly configPath?: string;
  /** Environment source; defaults to the current process environment. */
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

export interface LoadConfigOptions extends ParseConfigOptions {
  /** Explicit YAML location, taking precedence over REMOTE_DECK_CONFIG_PATH. */
  readonly configPath?: string;
}

interface ShapeNode {
  readonly children: Map<string, ShapeNode>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function invalid(path: string, message: string): never {
  throw new Error(`${path} ${message}`);
}

function yamlPath(path: readonly string[]): string {
  return `$.${path.join(".")}`;
}

/** Converts a camel-cased YAML path into its deterministic override name. */
export function environmentName(path: readonly string[]): string {
  const segments = path.map((segment) =>
    segment.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase(),
  );
  return `REMOTE_DECK_${segments.join("_")}`;
}

function shape(): ShapeNode {
  const root: ShapeNode = { children: new Map() };
  for (const spec of Object.values(FIELD_SPECS)) {
    let node = root;
    for (const segment of spec.path) {
      let child = node.children.get(segment);
      if (child === undefined) {
        child = { children: new Map() };
        node.children.set(segment, child);
      }
      node = child;
    }
  }
  return root;
}

const CONFIG_SHAPE = shape();

function rejectUnknownFields(
  value: unknown,
  node: ShapeNode,
  path: string,
): void {
  if (!isRecord(value)) {
    invalid(path, "must be an object");
  }
  for (const [field, childValue] of Object.entries(value)) {
    const child = node.children.get(field);
    if (child === undefined) {
      invalid(`${path}.${field}`, "is not a supported field");
    }
    if (child.children.size > 0) {
      rejectUnknownFields(childValue, child, `${path}.${field}`);
    }
  }
}

function valueAtPath(value: unknown, path: readonly string[]): unknown {
  let candidate = value;
  for (const segment of path) {
    if (!isRecord(candidate)) {
      return undefined;
    }
    candidate = candidate[segment];
  }
  return candidate;
}

function overrideFor(
  spec: FieldSpec,
  environment: Readonly<Record<string, string | undefined>>,
): { readonly name: string; readonly value: string } | undefined {
  const name = environmentName(spec.path);
  const value = environment[name];
  if (value !== undefined) {
    return { name, value };
  }

  if (spec === FIELD_SPECS.agentLogLevel) {
    const legacyValue = environment.REMOTE_DECK_LOG_LEVEL;
    if (legacyValue !== undefined) {
      return { name: "REMOTE_DECK_LOG_LEVEL", value: legacyValue };
    }
  }
  return undefined;
}

function parseField(
  yamlDocument: unknown,
  spec: FieldSpec,
  environment: Readonly<Record<string, string | undefined>>,
): ConfigPrimitive {
  const override = overrideFor(spec, environment);
  const value = override?.value ?? valueAtPath(yamlDocument, spec.path);
  const path = yamlPath(spec.path);
  const source = override === undefined ? path : `${override.name} (for ${path})`;

  let parsed: ConfigPrimitive;
  if (spec.kind === "string") {
    if (typeof value !== "string") {
      invalid(source, "must be a string");
    }
    if (value.trim() === "") {
      invalid(source, "must not be blank");
    }
    parsed = value;
  } else {
    if (
      override !== undefined &&
      (typeof value !== "string" || !/^-?\d+$/.test(value))
    ) {
      invalid(source, "must be an integer");
    }
    const numericValue = override === undefined ? value : Number(value);
    if (!Number.isInteger(numericValue)) {
      invalid(source, "must be an integer");
    }
    parsed = numericValue as number;
    if (spec.minimum !== undefined && parsed < spec.minimum) {
      invalid(source, `must be greater than or equal to ${spec.minimum}`);
    }
    if (spec.maximum !== undefined && parsed > spec.maximum) {
      invalid(source, `must be less than or equal to ${spec.maximum}`);
    }
  }

  if (
    spec.allowedValues !== undefined &&
    (typeof parsed !== "string" || !spec.allowedValues.has(parsed))
  ) {
    invalid(source, `must be one of: ${[...spec.allowedValues].join(", ")}`);
  }
  return parsed;
}

function configuredString(
  values: Readonly<Record<FieldKey, ConfigPrimitive>>,
  field: FieldKey,
): string {
  return values[field] as string;
}

function configuredInteger(
  values: Readonly<Record<FieldKey, ConfigPrimitive>>,
  field: FieldKey,
): number {
  return values[field] as number;
}

function configuredPath(configPath: string, value: string): string {
  return isAbsolute(value) ? value : resolve(dirname(configPath), value);
}

/** Parses, overrides, and validates YAML text into a complete typed value. */
export function parseConfig(
  source: string,
  options: ParseConfigOptions = {},
): RemoteDeckConfig {
  let document: unknown;
  try {
    document = parse(source);
  } catch (error) {
    invalid("$", `contains invalid YAML: ${errorMessage(error)}`);
  }
  rejectUnknownFields(document, CONFIG_SHAPE, "$");

  const environment = options.environment ?? process.env;
  const entries = Object.entries(FIELD_SPECS).map(([field, spec]) => [
    field,
    parseField(document, spec, environment),
  ]);
  const values = Object.fromEntries(entries) as Record<FieldKey, ConfigPrimitive>;
  const configPath = options.configPath ?? DEFAULT_CONFIG_PATH;
  const fontSize = configuredInteger(values, "fontSize");
  const maxFittedFontSize = configuredInteger(values, "maxFittedFontSize");
  if (maxFittedFontSize < fontSize) {
    invalid(
      "$.mobile.terminal.maxFittedFontSize",
      "must be greater than or equal to $.mobile.terminal.fontSize",
    );
  }

  return {
    agent: {
      protocol: configuredString(values, "agentProtocol") as AgentProtocol,
      host: configuredString(values, "agentHost"),
      port: configuredInteger(values, "agentPort"),
      logLevel: configuredString(values, "agentLogLevel") as AgentLogLevel,
      applicationCatalogPath: configuredPath(
        configPath,
        configuredString(values, "applicationCatalogPath"),
      ),
      projectStorePath: configuredPath(
        configPath,
        configuredString(values, "projectStorePath"),
      ),
    },
    tmux: {
      sessionPrefix: configuredString(values, "sessionPrefix"),
      terminal: {
        columns: configuredInteger(values, "terminalColumns"),
        rows: configuredInteger(values, "terminalRows"),
      },
    },
    mobile: {
      refreshDelayMs: configuredInteger(values, "refreshDelayMs"),
      terminal: { fontSize, maxFittedFontSize },
    },
  };
}

/** Reads the configured YAML path and enriches read/validation failures with it. */
export function loadConfig(options: LoadConfigOptions = {}): RemoteDeckConfig {
  const environment = options.environment ?? process.env;
  const configPath =
    options.configPath ?? environment.REMOTE_DECK_CONFIG_PATH ?? DEFAULT_CONFIG_PATH;

  let source: string;
  try {
    source = readFileSync(configPath, "utf8");
  } catch (error) {
    throw new Error(
      `Failed to read Remote Deck config at ${configPath}: ${errorMessage(error)}`,
      { cause: error },
    );
  }

  try {
    return parseConfig(source, { configPath, environment });
  } catch (error) {
    throw new Error(
      `Invalid Remote Deck config at ${configPath}: ${errorMessage(error)}`,
      { cause: error },
    );
  }
}

/** Removes server-only values before configuration is embedded in the client. */
export function toMobileConfig(config: RemoteDeckConfig): MobileConfig {
  return parseMobileConfig({
    agentUrl: `${config.agent.protocol}://${config.agent.host}:${config.agent.port}`,
    refreshDelayMs: config.mobile.refreshDelayMs,
    terminal: {
      columns: config.tmux.terminal.columns,
      rows: config.tmux.terminal.rows,
      fontSize: config.mobile.terminal.fontSize,
      maxFittedFontSize: config.mobile.terminal.maxFittedFontSize,
    },
  });
}
