/** Trusted application discovery, catalog lookup, and public projection. */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type {
  ApplicationActionTextInput,
  PublicApplication,
} from "@remote-deck/contracts";

/** An agent-owned action whose tmux behavior is never sent to clients. */
export interface AppActionDefinition {
  readonly id: string;
  readonly label: string;
  readonly sendKeysArgs: readonly string[];
  readonly input?: ApplicationActionTextInput;
  readonly sendKeysAfterInputArgs?: readonly string[];
}

/** An agent-owned application that may be launched by its public ID. */
export interface AppDefinition {
  readonly id: string;
  readonly title: string;
  readonly command: string;
  readonly actions: readonly AppActionDefinition[];
}

/** Source-module shape with loader-only display ordering. */
export interface ApplicationModuleDefinition extends AppDefinition {
  readonly order: number;
}

/** Read-only application and app-scoped action lookup boundary. */
export interface ApplicationCatalog {
  listApplications(): readonly AppDefinition[];
  getApplication(appId: string): AppDefinition | undefined;
  getAction(appId: string, actionId: string): AppActionDefinition | undefined;
}

/** In-memory catalog for trusted definitions declared in TypeScript. */
export class StaticApplicationCatalog implements ApplicationCatalog {
  constructor(private readonly applications: readonly AppDefinition[]) {}

  listApplications(): readonly AppDefinition[] {
    return this.applications;
  }

  getApplication(appId: string): AppDefinition | undefined {
    return this.applications.find((application) => application.id === appId);
  }

  getAction(appId: string, actionId: string): AppActionDefinition | undefined {
    return this.getApplication(appId)?.actions.find(
      (action) => action.id === actionId,
    );
  }
}

/** Removes private commands and tmux keys from one catalog entry. */
export function publicApplication(application: AppDefinition): PublicApplication {
  return {
    id: application.id,
    title: application.title,
    actions: application.actions.map(({ id, label, input }) => ({
      id,
      label,
      ...(input === undefined ? {} : { input: { ...input } }),
    })),
  };
}

const APPLICATION_DIRECTORY = new URL("./apps/", import.meta.url);
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

interface LoadedApplicationDefinition {
  readonly filename: string;
  readonly definition: ApplicationModuleDefinition;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidDefinition(
  filename: string,
  field: string,
  message: string,
): never {
  throw new Error(`Application definition "${filename}" ${field} ${message}`);
}

function validateId(value: unknown, filename: string, field: string): string {
  if (typeof value !== "string" || !SAFE_ID_PATTERN.test(value)) {
    invalidDefinition(
      filename,
      field,
      "must start with a lowercase letter or number and contain only lowercase letters, numbers, hyphens, or underscores",
    );
  }
  return value;
}

/** Validates invariants that TypeScript cannot enforce across discovered modules. */
function applicationDefinitionFromModule(
  module: unknown,
  filename: string,
): ApplicationModuleDefinition {
  if (!isRecord(module) || !isRecord(module.default)) {
    invalidDefinition(filename, "default export", "must be an object");
  }

  const definition = module.default;
  if (typeof definition.order !== "number" || !Number.isFinite(definition.order)) {
    invalidDefinition(filename, "default.order", "must be a finite number");
  }

  validateId(definition.id, filename, "default.id");
  if (!Array.isArray(definition.actions)) {
    invalidDefinition(filename, "default.actions", "must be an array");
  }

  const actionIds = new Set<string>();
  for (const [index, action] of definition.actions.entries()) {
    if (!isRecord(action)) {
      invalidDefinition(
        filename,
        `default.actions[${index}]`,
        "must be an object",
      );
    }
    const actionId = validateId(
      action.id,
      filename,
      `default.actions[${index}].id`,
    );
    if (actionIds.has(actionId)) {
      invalidDefinition(
        filename,
        `default.actions[${index}].id`,
        `duplicates action ID "${actionId}"`,
      );
    }
    actionIds.add(actionId);
  }

  return definition as unknown as ApplicationModuleDefinition;
}

async function importApplicationDefinition(
  directoryPath: string,
  filename: string,
): Promise<LoadedApplicationDefinition> {
  const moduleUrl = pathToFileURL(join(directoryPath, filename));
  let module: unknown;
  try {
    module = await import(moduleUrl.href);
  } catch (error) {
    throw new Error(`Failed to import application definition "${filename}"`, {
      cause: error,
    });
  }
  return {
    filename,
    definition: applicationDefinitionFromModule(module, filename),
  };
}

function withoutOrder(definition: ApplicationModuleDefinition): AppDefinition {
  return {
    id: definition.id,
    title: definition.title,
    command: definition.command,
    actions: definition.actions,
  };
}

/** Discovers trusted TypeScript app modules once and builds the production catalog. */
export async function loadApplicationCatalog(
  directory: URL = APPLICATION_DIRECTORY,
): Promise<ApplicationCatalog> {
  const directoryPath = fileURLToPath(directory);
  let entries;
  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    throw new Error(
      `Failed to read application definitions at ${directoryPath}`,
      { cause: error },
    );
  }

  const filenames = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".ts") &&
        !entry.name.endsWith(".d.ts"),
    )
    .map(({ name }) => name)
    .sort();
  if (filenames.length === 0) {
    throw new Error(`No application definitions found in ${directoryPath}`);
  }

  const loaded: LoadedApplicationDefinition[] = [];
  for (const filename of filenames) {
    loaded.push(await importApplicationDefinition(directoryPath, filename));
  }

  const filenamesByAppId = new Map<string, string>();
  for (const application of loaded) {
    const existingFilename = filenamesByAppId.get(application.definition.id);
    if (existingFilename !== undefined) {
      throw new Error(
        `Application definition "${application.filename}" duplicates application ID "${application.definition.id}" from "${existingFilename}"`,
      );
    }
    filenamesByAppId.set(application.definition.id, application.filename);
  }

  loaded.sort(
    (left, right) =>
      left.definition.order - right.definition.order ||
      left.definition.id.localeCompare(right.definition.id),
  );
  return new StaticApplicationCatalog(
    loaded.map(({ definition }) => withoutOrder(definition)),
  );
}
