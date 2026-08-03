/** Validation and pure command planning for configured application actions. */

import type { AppActionDefinition } from "./applications.js";

const ACTION_BODY_FIELDS = new Set(["input"]);

/** Safe validation failure that can be translated into a 400 response. */
export class InvalidActionRequestError extends Error {}

/** One ordered tmux operation in an application action macro. */
export type ActionCommand =
  | { readonly type: "keys"; readonly arguments: readonly string[] }
  | { readonly type: "literal"; readonly text: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint <= 0x1f ||
        (codePoint >= 0x7f && codePoint <= 0x9f) ||
        codePoint === 0x2028 ||
        codePoint === 0x2029)
    ) {
      return true;
    }
  }
  return false;
}

/** Parses the exact request body accepted by the selected action. */
export function parseActionRequestInput(
  action: AppActionDefinition,
  body: unknown,
): string | undefined {
  if (action.input === undefined) {
    if (body !== undefined) {
      throw new InvalidActionRequestError(
        "Immediate actions do not accept a request body.",
      );
    }
    return undefined;
  }

  if (!isRecord(body)) {
    throw new InvalidActionRequestError(
      'Input actions require an object body with an "input" field.',
    );
  }
  for (const field of Object.keys(body)) {
    if (!ACTION_BODY_FIELDS.has(field)) {
      throw new InvalidActionRequestError(
        `Action request field "${field}" is not supported.`,
      );
    }
  }

  const rawInput = body.input;
  if (typeof rawInput !== "string") {
    throw new InvalidActionRequestError("Action input must be a string.");
  }
  if (rawInput.length > action.input.maxLength) {
    throw new InvalidActionRequestError(
      `Action input must not exceed ${action.input.maxLength} characters.`,
    );
  }
  if (containsControlCharacter(rawInput)) {
    throw new InvalidActionRequestError(
      "Action input must be a single line without control characters.",
    );
  }

  const input = rawInput.trim();
  if (action.input.required && input === "") {
    throw new InvalidActionRequestError("Action input must not be blank.");
  }
  return input;
}

/** Builds the ordered keys, literal text, and suffix keys for one action. */
export function buildActionCommandPlan(
  action: AppActionDefinition,
  input: string | undefined,
): readonly ActionCommand[] {
  const plan: ActionCommand[] = [
    { type: "keys", arguments: action.sendKeysArgs },
  ];
  if (action.input === undefined) {
    return plan;
  }
  if (input === undefined) {
    throw new Error("Validated action input was not supplied for an input action.");
  }
  if (input !== "") {
    plan.push({ type: "literal", text: input });
  }
  if (action.sendKeysAfterInputArgs !== undefined) {
    plan.push({ type: "keys", arguments: action.sendKeysAfterInputArgs });
  }
  return plan;
}
