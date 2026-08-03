/** Application lifecycle boundary backed by exact-target tmux operations. */

import type { TerminalFrame } from "@remote-deck/contracts";
import type { TmuxConfig } from "@remote-deck/config";

import { buildActionCommandPlan } from "./actions.js";
import type { AppActionDefinition, AppDefinition } from "./applications.js";
import type { Project } from "./projects.js";

const TERMINAL_METADATA_FORMAT =
  "#{pane_width}\t#{pane_height}\t#{cursor_x}\t#{cursor_y}\t#{cursor_flag}";
const MISSING_TARGET_PATTERN =
  /no server running|no such (?:session|window|pane)|can't find (?:session|window|pane)|session not found|window not found|pane not found/i;

/** Complete lifecycle operations used by the HTTP adapter. */
export interface ApplicationRuntime {
  launch(project: Project, application: AppDefinition): Promise<void>;
  snapshot(project: Project, application: AppDefinition): Promise<TerminalFrame>;
  runAction(
    project: Project,
    application: AppDefinition,
    action: AppActionDefinition,
    input: string | undefined,
  ): Promise<boolean>;
}

/** Raw result from one shell-free tmux invocation. */
export interface TmuxExecutionResult {
  stdout: string;
  stderr: string;
}

/** Runs tmux with the supplied argument vector and no shell interpolation. */
export interface TmuxExecutor {
  (arguments_: readonly string[]): Promise<TmuxExecutionResult>;
}

/** Small logging surface needed by the tmux implementation. */
export interface RuntimeLogger {
  debug(context: object, message: string): void;
  info(context: object, message: string): void;
  error(context: object, message: string): void;
}

interface TmuxCallOptions {
  readonly logResponse?: boolean;
  readonly missingTargetIsExpected?: boolean;
}

/** Serializes complete action macros independently for each pane. */
class PaneActionQueue {
  readonly #tails = new Map<string, Promise<void>>();

  async run<Result>(
    target: string,
    operation: () => Promise<Result>,
  ): Promise<Result> {
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

function commandResponse(error: unknown): { stdout: unknown; stderr: unknown } {
  if (typeof error !== "object" || error === null) {
    return { stdout: undefined, stderr: undefined };
  }
  return {
    stdout: "stdout" in error ? error.stdout : undefined,
    stderr: "stderr" in error ? error.stderr : undefined,
  };
}

function errorText(error: unknown): string {
  if (typeof error !== "object" || error === null) {
    return String(error);
  }
  const stderr = "stderr" in error ? String(error.stderr) : "";
  const message = "message" in error ? String(error.message) : "";
  return `${stderr}\n${message}`;
}

/** Recognizes only failures that mean an exact tmux target no longer exists. */
export function isMissingTmuxTargetError(error: unknown): boolean {
  return MISSING_TARGET_PATTERN.test(errorText(error));
}

/** Tmux implementation of the complete application lifecycle. */
export class TmuxApplicationRuntime implements ApplicationRuntime {
  readonly #actionQueue = new PaneActionQueue();

  constructor(
    private readonly config: TmuxConfig,
    private readonly executeTmux: TmuxExecutor,
    private readonly logger: RuntimeLogger,
  ) {}

  async launch(project: Project, application: AppDefinition): Promise<void> {
    const session = this.sessionName(project);
    const target = this.paneTarget(project, application);

    if (
      await this.targetExists([
        "display-message",
        "-p",
        "-t",
        this.exact(target),
        "#{pane_id}",
      ])
    ) {
      this.logger.info(
        { projectId: project.id, appId: application.id, target },
        "reusing existing app window",
      );
      return;
    }

    const sessionExists = await this.targetExists([
      "has-session",
      "-t",
      this.exact(session),
    ]);
    if (!sessionExists) {
      await this.runTmux([
        "new-session",
        "-d",
        "-x",
        String(this.config.terminal.columns),
        "-y",
        String(this.config.terminal.rows),
        "-s",
        session,
        "-n",
        application.id,
        "-c",
        project.directory,
        application.command,
      ]);
      this.logger.info(
        { projectId: project.id, appId: application.id, session, target },
        "created project session with its first app window",
      );
      return;
    }

    await this.runTmux([
      "new-window",
      "-d",
      "-t",
      this.exact(session),
      "-n",
      application.id,
      "-c",
      project.directory,
      application.command,
    ]);
    this.logger.info(
      { projectId: project.id, appId: application.id, session, target },
      "created app window in existing project session",
    );
  }

  async snapshot(
    project: Project,
    application: AppDefinition,
  ): Promise<TerminalFrame> {
    const target = this.paneTarget(project, application);
    let ansi: string;
    try {
      ansi = await this.runTmux(
        ["capture-pane", "-p", "-e", "-N", "-t", this.exact(target)],
        { logResponse: false, missingTargetIsExpected: true },
      );
    } catch (error) {
      if (isMissingTmuxTargetError(error)) {
        return this.stoppedFrame();
      }
      throw error;
    }

    let metadata: string;
    try {
      metadata = await this.runTmux(
        [
          "display-message",
          "-p",
          "-t",
          this.exact(target),
          TERMINAL_METADATA_FORMAT,
        ],
        { missingTargetIsExpected: true },
      );
    } catch (error) {
      if (isMissingTmuxTargetError(error)) {
        return this.stoppedFrame();
      }
      throw error;
    }

    const [columns, rows, cursorX, cursorY, cursorVisible] = metadata
      .trimEnd()
      .split("\t")
      .map(Number);
    if (
      ![columns, rows, cursorX, cursorY, cursorVisible].every(Number.isInteger)
    ) {
      throw new Error(`tmux returned invalid terminal metadata for ${target}`);
    }

    return {
      running: true,
      columns: columns as number,
      rows: rows as number,
      ansi: ansi.replace(/\n$/, ""),
      cursorX: cursorX as number,
      cursorY: cursorY as number,
      cursorVisible: cursorVisible === 1,
    };
  }

  async runAction(
    project: Project,
    application: AppDefinition,
    action: AppActionDefinition,
    input: string | undefined,
  ): Promise<boolean> {
    const target = this.paneTarget(project, application);
    const commands = buildActionCommandPlan(action, input);

    return await this.#actionQueue.run(target, async () => {
      try {
        for (const command of commands) {
          const arguments_ =
            command.type === "keys"
              ? ["send-keys", "-t", this.exact(target), ...command.arguments]
              : [
                  "send-keys",
                  "-t",
                  this.exact(target),
                  "-l",
                  "--",
                  command.text,
                ];
          await this.runTmux(arguments_, { missingTargetIsExpected: true });
        }
      } catch (error) {
        if (isMissingTmuxTargetError(error)) {
          return false;
        }
        throw error;
      }

      this.logger.info(
        {
          projectId: project.id,
          appId: application.id,
          actionId: action.id,
          target,
        },
        "app action sent",
      );
      return true;
    });
  }

  private sessionName(project: Project): string {
    return `${this.config.sessionPrefix}${project.id}`;
  }

  private paneTarget(project: Project, application: AppDefinition): string {
    return `${this.sessionName(project)}:${application.id}.0`;
  }

  private exact(target: string): string {
    return `=${target}`;
  }

  private stoppedFrame(): TerminalFrame {
    return {
      running: false,
      columns: this.config.terminal.columns,
      rows: this.config.terminal.rows,
      ansi: "",
      cursorX: 0,
      cursorY: 0,
      cursorVisible: false,
    };
  }

  private async targetExists(arguments_: readonly string[]): Promise<boolean> {
    try {
      await this.runTmux(arguments_, {
        logResponse: false,
        missingTargetIsExpected: true,
      });
      return true;
    } catch (error) {
      if (isMissingTmuxTargetError(error)) {
        return false;
      }
      throw error;
    }
  }

  private async runTmux(
    arguments_: readonly string[],
    options: TmuxCallOptions = {},
  ): Promise<string> {
    const command = ["tmux", ...arguments_];
    try {
      const { stdout, stderr } = await this.executeTmux(arguments_);
      this.logger.debug(
        {
          command,
          response: options.logResponse === false ? { stderr } : { stdout, stderr },
        },
        "tmux command completed",
      );
      return stdout;
    } catch (error) {
      const context = {
        err: error,
        command,
        response: commandResponse(error),
      };
      if (
        options.missingTargetIsExpected === true &&
        isMissingTmuxTargetError(error)
      ) {
        this.logger.debug(context, "tmux target is not running");
      } else {
        this.logger.error(context, "tmux command failed");
      }
      throw error;
    }
  }
}
