/**
 * Injectable Remote Deck HTTP application.
 *
 * Startup supplies persistence, catalog, ID, and tmux dependencies so route and
 * orchestration behavior can be exercised without listening or spawning tmux.
 */

import Fastify, { type FastifyInstance } from "fastify";

import type { RemoteDeckConfig } from "@remote-deck/config";

import {
  executeAppAction,
  InvalidActionRequestError,
  PaneActionQueue,
  parseActionRequestInput,
} from "./actions.js";
import {
  publicApplication,
  type AppDefinition,
} from "./applications.js";
import type { Project, ProjectRepository } from "./projects.js";
import {
  privateInputLogCommand,
  privateTmuxFailureError,
  privateTmuxFailureStatus,
} from "./tmux-privacy.js";

const TERMINAL_METADATA_FORMAT =
  "#{pane_width}\t#{pane_height}\t#{cursor_x}\t#{cursor_y}\t#{cursor_flag}";

/** Complete terminal grid and cursor state returned to the mobile renderer. */
interface TerminalFrame {
  running: boolean;
  columns: number;
  rows: number;
  ansi: string;
  cursorX: number;
  cursorY: number;
  cursorVisible: boolean;
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

/** Dependencies supplied by the production entry point or a unit test. */
export interface AgentAppOptions {
  applications: readonly AppDefinition[];
  config: RemoteDeckConfig;
  projectRepository: ProjectRepository;
  createProjectId(): string;
  executeTmux: TmuxExecutor;
  logLevel?: string;
}

/** Controls how a tmux subprocess is represented in structured logs. */
interface TmuxOptions {
  logFailureAsDebug?: boolean;
  logResponse?: boolean;
  /** Prevents private argv and child-process errors from reaching structured logs. */
  sensitive?: boolean;
  /** Safe command representation used instead of the actual sensitive argv. */
  loggedCommand?: readonly string[];
}

/** Extracts child-process output from an unknown error for safe structured logging. */
function commandResponse(error: unknown): { stdout: unknown; stderr: unknown } {
  if (typeof error !== "object" || error === null) {
    return { stdout: undefined, stderr: undefined };
  }

  return {
    stdout: "stdout" in error ? error.stdout : undefined,
    stderr: "stderr" in error ? error.stderr : undefined,
  };
}

/** Builds the agent without opening files, spawning tmux, or listening on a port. */
export function createAgentApp({
  applications,
  config,
  projectRepository,
  createProjectId,
  executeTmux,
}: AgentAppOptions): FastifyInstance {
  const app = Fastify({ logger: { level: config.agent.logLevel } });
  const paneActionQueue = new PaneActionQueue();

  /** Runs tmux while applying response and privacy-aware structured logging. */
  async function runTmux(
    arguments_: readonly string[],
    options: TmuxOptions = {},
  ): Promise<string> {
    const command = ["tmux", ...arguments_];
    const loggedCommand =
      options.sensitive === true
        ? (options.loggedCommand ?? [
            "tmux",
            arguments_[0] ?? "command",
            "[REDACTED]",
          ])
        : command;
    const logResponse = options.logResponse ?? true;

    try {
      const { stdout, stderr } = await executeTmux(arguments_);
      const response =
        options.sensitive === true
          ? undefined
          : logResponse
            ? { stdout, stderr }
            : { stderr };
      app.log.debug({ command: loggedCommand, response }, "tmux command completed");
      return stdout;
    } catch (error) {
      if (options.sensitive === true) {
        app.log.error(
          { command: loggedCommand, failure: privateTmuxFailureStatus(error) },
          "sensitive tmux command failed",
        );
        // Do not attach the child error: Node includes the original argv in its message.
        throw privateTmuxFailureError();
      }

      const response = commandResponse(error);
      const context = {
        ...(logResponse && !options.logFailureAsDebug && { err: error }),
        command: loggedCommand,
        response: logResponse ? response : { stderr: response.stderr },
      };

      if (options.logFailureAsDebug === true) {
        app.log.debug(context, "tmux probe did not find its target");
      } else {
        app.log.error(context, "tmux command failed");
      }
      throw error;
    }
  }

  /** Convenience wrapper for tmux commands whose failures are operational errors. */
  async function tmux(...arguments_: string[]): Promise<string> {
    return await runTmux(arguments_);
  }

  /** Derives the private tmux session name owned by a project. */
  function sessionName(project: Project): string {
    return `${config.tmux.sessionPrefix}${project.id}`;
  }

  /** Targets the single primary pane in an application's named tmux window. */
  function paneTarget(project: Project, application: AppDefinition): string {
    return `${sessionName(project)}:${application.id}.0`;
  }

  /** Checks whether the project's lazily created tmux session currently exists. */
  async function sessionExists(project: Project): Promise<boolean> {
    const session = sessionName(project);
    try {
      await runTmux(["has-session", "-t", session], {
        logFailureAsDebug: true,
        logResponse: false,
      });
      app.log.debug(
        { projectId: project.id, session, exists: true },
        "tmux session checked",
      );
      return true;
    } catch {
      app.log.debug(
        { projectId: project.id, session, exists: false },
        "tmux session checked",
      );
      return false;
    }
  }

  /** Checks exact window names to avoid tmux falling back to the current window. */
  async function appWindowExists(
    project: Project,
    application: AppDefinition,
  ): Promise<boolean> {
    if (!(await sessionExists(project))) {
      app.log.debug(
        { projectId: project.id, appId: application.id, exists: false },
        "app window checked without a project session",
      );
      return false;
    }

    const windowNames = await tmux(
      "list-windows",
      "-t",
      sessionName(project),
      "-F",
      "#{window_name}",
    );
    const exists = windowNames.trimEnd().split("\n").includes(application.id);
    app.log.debug(
      { projectId: project.id, appId: application.id, exists },
      "app window checked",
    );
    return exists;
  }

  /** Creates the project's first session/window, adds a sibling, or reuses one. */
  async function ensureAppWindow(
    project: Project,
    application: AppDefinition,
  ): Promise<void> {
    if (await appWindowExists(project, application)) {
      app.log.info(
        {
          projectId: project.id,
          appId: application.id,
          session: sessionName(project),
          target: paneTarget(project, application),
        },
        "reusing existing app window",
      );
      return;
    }

    const projectSession = sessionName(project);
    if (!(await sessionExists(project))) {
      await tmux(
        "new-session",
        "-d",
        "-x",
        String(config.tmux.terminal.columns),
        "-y",
        String(config.tmux.terminal.rows),
        "-s",
        projectSession,
        "-n",
        application.id,
        "-c",
        project.directory,
        application.command,
      );
      app.log.info(
        {
          projectId: project.id,
          appId: application.id,
          directory: project.directory,
          session: projectSession,
          target: paneTarget(project, application),
        },
        "created project session with its first app window",
      );
      return;
    }

    await tmux(
      "new-window",
      "-d",
      "-t",
      projectSession,
      "-n",
      application.id,
      "-c",
      project.directory,
      application.command,
    );
    app.log.info(
      {
        projectId: project.id,
        appId: application.id,
        directory: project.directory,
        session: projectSession,
        target: paneTarget(project, application),
      },
      "created app window in existing project session",
    );
  }

  /** Returns the stable empty frame used when an app window is not running. */
  function stoppedFrame(): TerminalFrame {
    return {
      running: false,
      columns: config.tmux.terminal.columns,
      rows: config.tmux.terminal.rows,
      ansi: "",
      cursorX: 0,
      cursorY: 0,
      cursorVisible: false,
    };
  }

  /** Captures one app pane without ever writing its terminal contents to logs. */
  async function captureApp(
    project: Project,
    application: AppDefinition,
  ): Promise<TerminalFrame> {
    if (!(await appWindowExists(project, application))) {
      app.log.debug(
        { projectId: project.id, appId: application.id, running: false },
        "terminal snapshot requested for a stopped app",
      );
      return stoppedFrame();
    }

    const target = paneTarget(project, application);
    const ansi = await runTmux(
      ["capture-pane", "-p", "-e", "-N", "-t", target],
      { logResponse: false },
    );
    const metadata = await tmux(
      "display-message",
      "-p",
      "-t",
      target,
      TERMINAL_METADATA_FORMAT,
    );
    const metadataFields = metadata.trimEnd().split("\t");

    const frame: TerminalFrame = {
      running: true,
      columns: Number(metadataFields[0]),
      rows: Number(metadataFields[1]),
      ansi: ansi.replace(/\n$/, ""),
      cursorX: Number(metadataFields[2]),
      cursorY: Number(metadataFields[3]),
      cursorVisible: Number(metadataFields[4]) === 1,
    };
    app.log.debug(
      {
        projectId: project.id,
        appId: application.id,
        target,
        columns: frame.columns,
        rows: frame.rows,
        cursorX: frame.cursorX,
        cursorY: frame.cursorY,
        cursorVisible: frame.cursorVisible,
      },
      "terminal snapshot captured",
    );
    return frame;
  }

  /** Resolves an allow-listed application definition from a public app ID. */
  function findApplication(appId: string): AppDefinition | undefined {
    return applications.find((application) => application.id === appId);
  }

  // Project routes expose the repository without leaking its JSON representation.
  app.get("/projects", async () => {
    const projects = await projectRepository.listProjects();
    app.log.debug({ projectCount: projects.length }, "projects listed");
    return projects;
  });

  app.get<{ Params: { projectId: string } }>(
    "/projects/:projectId",
    async (request, reply) => {
      const project = await projectRepository.getProject(request.params.projectId);
      if (project === undefined) {
        request.log.warn(
          { projectId: request.params.projectId },
          "project not found",
        );
        return await reply.code(404).send();
      }

      request.log.debug({ projectId: project.id }, "project retrieved");
      return project;
    },
  );

  app.post<{ Body: { name: string; directory: string } }>(
    "/projects",
    async (request, reply) => {
      const project: Project = {
        id: createProjectId(),
        name: request.body.name,
        directory: request.body.directory,
      };

      try {
        await projectRepository.addProject(project);
      } catch (error) {
        request.log.error(
          { err: error, projectId: project.id, directory: project.directory },
          "failed to persist project",
        );
        throw error;
      }

      request.log.info(
        { projectId: project.id, name: project.name, directory: project.directory },
        "project created",
      );
      return await reply.code(201).send(project);
    },
  );

  // Public catalog routes deliberately omit executable commands and tmux arguments.
  app.get("/apps", async () => {
    const publicApplications = applications.map(publicApplication);
    app.log.debug(
      { appCount: publicApplications.length },
      "application catalog listed",
    );
    return publicApplications;
  });

  app.get<{ Params: { appId: string } }>(
    "/apps/:appId",
    async (request, reply) => {
      const application = findApplication(request.params.appId);
      if (application === undefined) {
        request.log.warn({ appId: request.params.appId }, "application not found");
        return await reply.code(404).send();
      }

      request.log.debug({ appId: application.id }, "application retrieved");
      return publicApplication(application);
    },
  );

  // App routes translate project and app IDs into exact tmux session/window targets.
  app.post<{ Params: { projectId: string; appId: string } }>(
    "/projects/:projectId/apps/:appId/launch",
    async (request, reply) => {
      const project = await projectRepository.getProject(request.params.projectId);
      const application = findApplication(request.params.appId);
      if (project === undefined || application === undefined) {
        request.log.warn(
          {
            projectId: request.params.projectId,
            appId: request.params.appId,
            projectFound: project !== undefined,
            appFound: application !== undefined,
          },
          "app launch target not found",
        );
        return await reply.code(404).send();
      }

      request.log.info(
        { projectId: project.id, appId: application.id },
        "app launch requested",
      );
      await ensureAppWindow(project, application);
      return await reply.code(204).send();
    },
  );

  app.get<{ Params: { projectId: string; appId: string } }>(
    "/projects/:projectId/apps/:appId/snapshot",
    async (request, reply) => {
      const project = await projectRepository.getProject(request.params.projectId);
      const application = findApplication(request.params.appId);
      if (project === undefined || application === undefined) {
        request.log.warn(
          {
            projectId: request.params.projectId,
            appId: request.params.appId,
            projectFound: project !== undefined,
            appFound: application !== undefined,
          },
          "snapshot target not found",
        );
        return await reply.code(404).send();
      }

      return await captureApp(project, application);
    },
  );

  app.post<{
    Params: { projectId: string; appId: string; actionId: string };
    Body: unknown;
  }>(
    "/projects/:projectId/apps/:appId/actions/:actionId",
    async (request, reply) => {
      const project = await projectRepository.getProject(request.params.projectId);
      const application = findApplication(request.params.appId);
      // Resolve within the selected app so equal IDs may differ safely per app.
      const action = application?.actions.find(
        (candidate) => candidate.id === request.params.actionId,
      );
      if (
        project === undefined ||
        application === undefined ||
        action === undefined
      ) {
        request.log.warn(
          {
            projectId: request.params.projectId,
            appId: request.params.appId,
            actionId: request.params.actionId,
            projectFound: project !== undefined,
            appFound: application !== undefined,
            actionKnown: action !== undefined,
          },
          "action target not found",
        );
        return await reply.code(404).send();
      }

      let actionInput: string | undefined;
      try {
        actionInput = parseActionRequestInput(action, request.body);
      } catch (error) {
        if (!(error instanceof InvalidActionRequestError)) {
          throw error;
        }
        request.log.warn(
          {
            projectId: project.id,
            appId: application.id,
            actionId: action.id,
            reason: error.message,
          },
          "invalid app action request",
        );
        return await reply.code(400).send();
      }

      if (!(await appWindowExists(project, application))) {
        request.log.warn(
          { projectId: project.id, appId: application.id, actionId: action.id },
          "action requested for a stopped app",
        );
        return await reply.code(404).send();
      }

      const target = paneTarget(project, application);
      await paneActionQueue.run(target, async () => {
        await executeAppAction(
          action,
          actionInput,
          async (_phase, arguments_, options) => {
            if (!options.literal) {
              await tmux("send-keys", "-t", target, ...arguments_);
              return;
            }

            await runTmux(
              ["send-keys", "-t", target, "-l", "--", ...arguments_],
              {
                sensitive: options.sensitive,
                loggedCommand: privateInputLogCommand(target),
              },
            );
          },
        );
      });
      request.log.info(
        {
          projectId: project.id,
          appId: application.id,
          actionId: action.id,
          target,
        },
        "app action sent",
      );
      return await reply.code(204).send();
    },
  );

  return app;
}
