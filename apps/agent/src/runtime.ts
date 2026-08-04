/** Application lifecycle boundary backed by exact-target tmux operations. */

import type { TerminalFrame } from "@remote-deck/contracts";
import type { TmuxConfig } from "@remote-deck/config";

import {
  buildActionCommandPlan,
  type ActionCommand,
} from "./actions.js";
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

interface PaneMetadata {
  readonly columns: number;
  readonly rows: number;
  readonly cursorX: number;
  readonly cursorY: number;
  readonly cursorVisible: boolean;
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

    if (await this.paneExists(target)) {
      this.logger.info(
        { projectId: project.id, appId: application.id, target },
        "reusing existing app window",
      );
      return;
    }

    if (!(await this.sessionExists(session))) {
      await this.createSession(session, project, application);
      this.logger.info(
        { projectId: project.id, appId: application.id, session, target },
        "created project session with its first app window",
      );
      return;
    }

    await this.createWindow(session, project, application);
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
    const ansi = await this.capturePane(target);
    if (ansi === undefined) {
      return this.stoppedFrame();
    }

    const metadata = await this.readPaneMetadata(target);
    if (metadata === undefined) {
      return this.stoppedFrame();
    }
    return {
      running: true,
      ...metadata,
      ansi: ansi.replace(/\n$/, ""),
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
      for (const command of commands) {
        if (!(await this.sendActionCommand(target, command))) {
          return false;
        }
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

  private async paneExists(target: string): Promise<boolean> {
    return (
      (await this.runForExistingTarget(
        [
          "display-message",
          "-p",
          "-t",
          this.exact(target),
          "#{pane_id}",
        ],
        { logResponse: false },
      )) !== undefined
    );
  }

  private async sessionExists(session: string): Promise<boolean> {
    return (
      (await this.runForExistingTarget(
        ["has-session", "-t", this.exact(session)],
        { logResponse: false },
      )) !== undefined
    );
  }

  private async createSession(
    session: string,
    project: Project,
    application: AppDefinition,
  ): Promise<void> {
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
  }

  private async createWindow(
    session: string,
    project: Project,
    application: AppDefinition,
  ): Promise<void> {
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
  }

  private async capturePane(target: string): Promise<string | undefined> {
    return await this.runForExistingTarget(
      ["capture-pane", "-p", "-e", "-N", "-t", this.exact(target)],
      { logResponse: false },
    );
  }

  private async readPaneMetadata(
    target: string,
  ): Promise<PaneMetadata | undefined> {
    const response = await this.runForExistingTarget([
      "display-message",
      "-p",
      "-t",
      this.exact(target),
      TERMINAL_METADATA_FORMAT,
    ]);
    if (response === undefined) {
      return undefined;
    }

    const [columns, rows, cursorX, cursorY, cursorVisible] = response
      .trimEnd()
      .split("\t")
      .map(Number);
    if (
      ![columns, rows, cursorX, cursorY, cursorVisible].every(Number.isInteger)
    ) {
      throw new Error(`tmux returned invalid terminal metadata for ${target}`);
    }
    return {
      columns: columns as number,
      rows: rows as number,
      cursorX: cursorX as number,
      cursorY: cursorY as number,
      cursorVisible: cursorVisible === 1,
    };
  }

  private async sendActionCommand(
    target: string,
    command: ActionCommand,
  ): Promise<boolean> {
    return command.type === "keys"
      ? await this.sendKeysToPane(target, command.arguments)
      : await this.sendLiteralTextToPane(target, command.text);
  }

  private async sendKeysToPane(
    target: string,
    keys: readonly string[],
  ): Promise<boolean> {
    return (
      (await this.runForExistingTarget([
        "send-keys",
        "-t",
        this.exact(target),
        ...keys,
      ])) !== undefined
    );
  }

  private async sendLiteralTextToPane(
    target: string,
    text: string,
  ): Promise<boolean> {
    return (
      (await this.runForExistingTarget([
        "send-keys",
        "-t",
        this.exact(target),
        "-l",
        "--",
        text,
      ])) !== undefined
    );
  }

  private async runForExistingTarget(
    arguments_: readonly string[],
    options: Omit<TmuxCallOptions, "missingTargetIsExpected"> = {},
  ): Promise<string | undefined> {
    try {
      return await this.runTmux(arguments_, {
        ...options,
        missingTargetIsExpected: true,
      });
    } catch (error) {
      if (isMissingTmuxTargetError(error)) {
        return undefined;
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
