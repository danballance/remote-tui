/** Cross-platform validation for the public configuration embedded by Expo. */

import type { MobileConfig } from "./types.ts";

export type { MobileConfig, MobileTerminalConfig } from "./types.ts";

const MOBILE_FIELDS = new Set(["agentUrl", "refreshDelayMs", "terminal"]);
const TERMINAL_FIELDS = new Set([
  "columns",
  "rows",
  "fontSize",
  "maxFittedFontSize",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(path: string, message: string): never {
  throw new Error(`${path} ${message}`);
}

function requiredRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    invalid(path, "must be an object");
  }
  return value;
}

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

function requiredNonBlankString(
  value: Record<string, unknown>,
  field: string,
  path: string,
): string {
  const candidate = value[field];
  if (typeof candidate !== "string") {
    invalid(`${path}.${field}`, "must be a string");
  }
  if (candidate.trim() === "") {
    invalid(`${path}.${field}`, "must not be blank");
  }
  return candidate;
}

function requiredInteger(
  value: Record<string, unknown>,
  field: string,
  path: string,
  minimum: number,
): number {
  const candidate = value[field];
  if (!Number.isInteger(candidate) || (candidate as number) < minimum) {
    invalid(
      `${path}.${field}`,
      `must be an integer greater than or equal to ${minimum}`,
    );
  }
  return candidate as number;
}

/** Converts unknown Expo manifest data into trusted mobile configuration. */
export function parseMobileConfig(value: unknown): MobileConfig {
  const config = requiredRecord(value, "$mobileConfig");
  rejectUnknownFields(config, MOBILE_FIELDS, "$mobileConfig");

  const agentUrl = requiredNonBlankString(config, "agentUrl", "$mobileConfig");
  let parsedAgentUrl: URL;
  try {
    parsedAgentUrl = new URL(agentUrl);
  } catch (error) {
    invalid(
      "$mobileConfig.agentUrl",
      `must be a valid HTTP URL: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (parsedAgentUrl.protocol !== "http:" && parsedAgentUrl.protocol !== "https:") {
    invalid("$mobileConfig.agentUrl", "must use the http or https protocol");
  }

  const terminal = requiredRecord(
    config.terminal,
    "$mobileConfig.terminal",
  );
  rejectUnknownFields(terminal, TERMINAL_FIELDS, "$mobileConfig.terminal");
  const fontSize = requiredInteger(
    terminal,
    "fontSize",
    "$mobileConfig.terminal",
    1,
  );
  const maxFittedFontSize = requiredInteger(
    terminal,
    "maxFittedFontSize",
    "$mobileConfig.terminal",
    1,
  );
  if (maxFittedFontSize < fontSize) {
    invalid(
      "$mobileConfig.terminal.maxFittedFontSize",
      "must be greater than or equal to $mobileConfig.terminal.fontSize",
    );
  }

  return {
    agentUrl,
    refreshDelayMs: requiredInteger(
      config,
      "refreshDelayMs",
      "$mobileConfig",
      0,
    ),
    terminal: {
      columns: requiredInteger(
        terminal,
        "columns",
        "$mobileConfig.terminal",
        1,
      ),
      rows: requiredInteger(terminal, "rows", "$mobileConfig.terminal", 1),
      fontSize,
      maxFittedFontSize,
    },
  };
}
