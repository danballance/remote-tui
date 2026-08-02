/** Validates and executes configured application actions without exposing TUI details. */

import type { AppActionDefinition } from "./applications.js";

const ACTION_BODY_FIELDS = new Set(["input"]);

/** Safe validation failure that can be returned as a 400 without echoing user input. */
export class InvalidActionRequestError extends Error {}

/** Identifies one phase of a configured action sequence for diagnostics and tests. */
export type ActionExecutionPhase = "before-input" | "input" | "after-input";

/** Sends either configured key names or one sensitive literal string to a pane. */
export interface ActionKeySender {
  (
    phase: ActionExecutionPhase,
    arguments_: readonly string[],
    options: { literal: boolean; sensitive: boolean },
  ): Promise<void>;
}

/** Narrows an unknown request body without trusting its prototype. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Finds terminal control bytes without embedding them in a regular expression. */
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

/** Parses the exact request body required by the selected action. */
export function parseActionRequestInput(
  action: AppActionDefinition,
  body: unknown,
): string | undefined {
  if (action.input === undefined) {
    if (body !== undefined) {
      throw new InvalidActionRequestError("Immediate actions do not accept a request body.");
    }
    return undefined;
  }

  if (!isRecord(body)) {
    throw new InvalidActionRequestError('Input actions require an object body with an "input" field.');
  }
  for (const field of Object.keys(body)) {
    if (!ACTION_BODY_FIELDS.has(field)) {
      throw new InvalidActionRequestError(`Action request field "${field}" is not supported.`);
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

/** Runs one action in strict key, literal-input, then key order. */
export async function executeAppAction(
  action: AppActionDefinition,
  input: string | undefined,
  sendKeys: ActionKeySender,
): Promise<void> {
  if (action.input !== undefined && input === undefined) {
    throw new Error("Validated action input was not supplied for an input action.");
  }

  await sendKeys("before-input", action.sendKeysArgs, {
    literal: false,
    sensitive: false,
  });

  if (action.input === undefined) {
    return;
  }
  // The preflight guard above guarantees this; repeat the narrowing after the await.
  if (input === undefined) {
    throw new Error("Validated action input was not supplied for an input action.");
  }
  if (input !== "") {
    await sendKeys("input", [input], { literal: true, sensitive: true });
  }
  if (action.sendKeysAfterInputArgs !== undefined) {
    await sendKeys("after-input", action.sendKeysAfterInputArgs, {
      literal: false,
      sensitive: false,
    });
  }
}

/** Serializes complete action macros independently for each target pane. */
export class PaneActionQueue {
  readonly #tails = new Map<string, Promise<void>>();

  async run<Result>(target: string, operation: () => Promise<Result>): Promise<Result> {
    const previous = this.#tails.get(target) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.#tails.set(target, tail);

    try {
      return await result;
    } finally {
      if (this.#tails.get(target) === tail) {
        this.#tails.delete(target);
      }
    }
  }
}
