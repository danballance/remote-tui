/**
 * Loads Remote Deck's trusted application catalog from YAML.
 *
 * The catalog is read once at agent startup. Strict validation turns authoring
 * mistakes into startup failures instead of running a partial or ambiguous
 * command allow-list.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

/** A server-owned action exposed by ID while its tmux behavior remains private. */
export interface AppActionDefinition {
  /** Stable route identifier, scoped to the application that owns the action. */
  id: string;
  /** Client-safe text used to render and announce the action button. */
  label: string;
  /** Arguments appended after the server-owned `send-keys -t <pane>` prefix. */
  sendKeysArgs: readonly string[];
}

/** A server-owned application that clients may launch but may not reconfigure. */
export interface AppDefinition {
  /** Stable route and tmux-window identifier. */
  id: string;
  /** Client-safe application name. */
  title: string;
  /** Trusted command used only when the agent creates this app's tmux window. */
  command: string;
  /** Ordered controls advertised to clients and resolved only within this app. */
  actions: readonly AppActionDefinition[];
}

/** Fixed catalog path, resolved independently of the agent's working directory. */
export const APPLICATION_CATALOG_PATH = fileURLToPath(
  new URL("../apps.yaml", import.meta.url),
);

const APP_FIELDS = new Set(["id", "title", "command", "actions"]);
const ACTION_FIELDS = new Set(["id", "label", "sendKeysArgs"]);
const CATALOG_FIELDS = new Set(["apps"]);
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/** Narrows parsed YAML mappings without trusting their field values. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Produces uniform, field-addressed validation failures for catalog authors. */
function invalid(path: string, message: string, cause?: unknown): never {
  throw new Error(`${path} ${message}`, cause === undefined ? undefined : { cause });
}

/** Converts unknown failures into concise messages without discarding their causes. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Rejects misspelled or unsupported fields rather than silently ignoring them. */
function rejectUnknownFields(
  value: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
  path: string,
): void {
  for (const field of Object.keys(value)) {
    if (!allowedFields.has(field)) {
      invalid(`${path}.${field}`, "is not a supported field");
    }
  }
}

/** Reads a required non-blank string while retaining its configured contents. */
function requiredString(
  value: Record<string, unknown>,
  field: string,
  path: string,
): string {
  const fieldPath = `${path}.${field}`;
  const candidate = value[field];
  if (typeof candidate !== "string") {
    invalid(fieldPath, "must be a string");
  }
  if (candidate.trim() === "") {
    invalid(fieldPath, "must not be blank");
  }
  return candidate;
}

/** Validates IDs for safe use in HTTP route segments and tmux window targets. */
function requiredId(
  value: Record<string, unknown>,
  field: string,
  path: string,
): string {
  const id = requiredString(value, field, path);
  if (!SAFE_ID_PATTERN.test(id)) {
    invalid(
      `${path}.${field}`,
      "must start with a lowercase letter or number and contain only lowercase letters, numbers, hyphens, or underscores",
    );
  }
  return id;
}

/** Validates one action and preserves its tmux argument order exactly. */
function parseAction(value: unknown, path: string): AppActionDefinition {
  if (!isRecord(value)) {
    invalid(path, "must be an object");
  }
  rejectUnknownFields(value, ACTION_FIELDS, path);

  const sendKeysArgsPath = `${path}.sendKeysArgs`;
  const configuredArguments = value.sendKeysArgs;
  if (!Array.isArray(configuredArguments) || configuredArguments.length === 0) {
    invalid(sendKeysArgsPath, "must be a non-empty array of strings");
  }
  const sendKeysArgs = configuredArguments.map((argument, index) => {
    if (typeof argument !== "string" || argument.trim() === "") {
      invalid(`${sendKeysArgsPath}[${index}]`, "must be a non-blank string");
    }
    return argument;
  });

  return {
    id: requiredId(value, "id", path),
    label: requiredString(value, "label", path),
    sendKeysArgs,
  };
}

/** Validates one application and enforces action-ID uniqueness within its scope. */
function parseApplication(value: unknown, path: string): AppDefinition {
  if (!isRecord(value)) {
    invalid(path, "must be an object");
  }
  rejectUnknownFields(value, APP_FIELDS, path);

  if (!Array.isArray(value.actions)) {
    invalid(`${path}.actions`, "must be an array");
  }

  const actionIds = new Set<string>();
  const actions = value.actions.map((action, index) => {
    const actionPath = `${path}.actions[${index}]`;
    const parsedAction = parseAction(action, actionPath);
    if (actionIds.has(parsedAction.id)) {
      invalid(`${actionPath}.id`, `duplicates action ID "${parsedAction.id}"`);
    }
    actionIds.add(parsedAction.id);
    return parsedAction;
  });

  return {
    id: requiredId(value, "id", path),
    title: requiredString(value, "title", path),
    command: requiredString(value, "command", path),
    actions,
  };
}

/** Converts YAML text into a fully validated catalog without reordering entries. */
export function parseApplicationCatalog(source: string): readonly AppDefinition[] {
  let document: unknown;
  try {
    document = parse(source);
  } catch (error) {
    invalid("$", `contains invalid YAML: ${errorMessage(error)}`, error);
  }

  if (!isRecord(document)) {
    invalid("$", "must be an object");
  }
  rejectUnknownFields(document, CATALOG_FIELDS, "$");
  if (!Array.isArray(document.apps)) {
    invalid("$.apps", "must be an array");
  }

  const appIds = new Set<string>();
  return document.apps.map((application, index) => {
    const appPath = `$.apps[${index}]`;
    const parsedApplication = parseApplication(application, appPath);
    if (appIds.has(parsedApplication.id)) {
      invalid(`${appPath}.id`, `duplicates application ID "${parsedApplication.id}"`);
    }
    appIds.add(parsedApplication.id);
    return parsedApplication;
  });
}

/** Reads the fixed startup catalog and adds its location to any failure. */
export async function loadApplicationCatalog(
  catalogPath: string = APPLICATION_CATALOG_PATH,
): Promise<readonly AppDefinition[]> {
  let source: string;
  try {
    source = await readFile(catalogPath, "utf8");
  } catch (error) {
    throw new Error(
      `Failed to read application catalog at ${catalogPath}: ${errorMessage(error)}`,
      { cause: error },
    );
  }

  try {
    return parseApplicationCatalog(source);
  } catch (error) {
    throw new Error(
      `Invalid application catalog at ${catalogPath}: ${errorMessage(error)}`,
      { cause: error },
    );
  }
}
