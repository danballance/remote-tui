/**
 * Remote Deck's desktop agent.
 *
 * The HTTP API exposes persisted projects and an allow-listed application
 * catalog. Each project maps to one tmux session and each application maps to a
 * single named window whose primary pane is captured and controlled through
 * actions defined by that application.
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import Fastify from "fastify";

import {
  createJsonProjectRepository,
  type Project,
  type ProjectRepository,
} from "./projects.js";

const AGENT_HOST = "192.168.86.75";
const AGENT_PORT = 43_820;
/** Set to `debug` when tmux probes and snapshot metadata are needed. */
const AGENT_LOG_LEVEL = process.env.REMOTE_DECK_LOG_LEVEL ?? "info";
const PROJECT_STORE_PATH = fileURLToPath(
  new URL("../.data/projects.json", import.meta.url),
);
const SESSION_PREFIX = "remote-deck-";
const TERMINAL_COLUMNS = 120;
const TERMINAL_ROWS = 35;
const TERMINAL_METADATA_FORMAT =
  "#{pane_width}\t#{pane_height}\t#{cursor_x}\t#{cursor_y}\t#{cursor_flag}";

/** A server-owned action exposed by ID while its tmux behavior remains private. */
interface AppActionDefinition {
  /** Stable route identifier, scoped to the application that owns the action. */
  id: string;
  /** Client-safe text used to render and announce the action button. */
  label: string;
  /** Arguments appended after the server-owned `send-keys -t <pane>` prefix. */
  sendKeysArgs: readonly string[];
}

/** A server-owned application that clients may launch but may not reconfigure. */
interface AppDefinition {
  id: string;
  title: string;
  command: string;
  /** Ordered controls advertised to clients and resolved only within this app. */
  actions: readonly AppActionDefinition[];
}

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

/** Controls how a tmux subprocess is represented in structured logs. */
interface TmuxOptions {
  logFailureAsDebug?: boolean;
  logResponse?: boolean;
}

/** Fixed catalog; clients select application and action IDs but never supply commands. */
const APP_DEFINITIONS: readonly AppDefinition[] = [
  {
    id: "lazygit",
    title: "LazyGit",
    command: "exec lazygit",
    actions: [
      { id: "up", label: "Up", sendKeysArgs: ["Up"] },
      { id: "down", label: "Down", sendKeysArgs: ["Down"] },
    ],
  },
  {
    id: "yazi",
    title: "Yazi",
    command: "exec yazi",
    actions: [
      { id: "up", label: "Up", sendKeysArgs: ["Up"] },
      { id: "down", label: "Down", sendKeysArgs: ["Down"] },
    ],
  },
  {
    id: "pi",
    title: "Pi",
    command: "exec pi",
    actions: [
      { id: "up", label: "Up", sendKeysArgs: ["Up"] },
      { id: "down", label: "Down", sendKeysArgs: ["Down"] },
    ],
  },
];

const execFileAsync = promisify(execFile);
const app = Fastify({ logger: { level: AGENT_LOG_LEVEL } });

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

/**
 * Runs tmux without a shell and logs the exact argument vector.
 *
 * Terminal captures opt out of response logging so terminal contents never
 * enter logs. Expected probe failures can be demoted to debug level.
 */
async function runTmux(args: string[], options: TmuxOptions = {}): Promise<string> {
  const command = ["tmux", ...args];
  const logResponse = options.logResponse ?? true;

  try {
    const { stdout, stderr } = await execFileAsync("tmux", args, { encoding: "utf8" });
    const response = logResponse ? { stdout, stderr } : { stderr };
    app.log.debug({ command, response }, "tmux command completed");
    return stdout;
  } catch (error) {
    const response = commandResponse(error);
    const context = {
      ...(logResponse && !options.logFailureAsDebug && { err: error }),
      command,
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
async function tmux(...args: string[]): Promise<string> {
  return await runTmux(args);
}

/** Derives the private tmux session name owned by a project. */
function sessionName(project: Project): string {
  return `${SESSION_PREFIX}${project.id}`;
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
    app.log.debug({ projectId: project.id, session, exists: true }, "tmux session checked");
    return true;
  } catch {
    app.log.debug({ projectId: project.id, session, exists: false }, "tmux session checked");
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

/**
 * Ensures one persistent window exists for an application.
 *
 * The first application creates the session and its first window. Later
 * applications create sibling windows; an existing window is reused unchanged.
 */
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
      String(TERMINAL_COLUMNS),
      "-y",
      String(TERMINAL_ROWS),
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
    columns: TERMINAL_COLUMNS,
    rows: TERMINAL_ROWS,
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
  const ansi = await runTmux(["capture-pane", "-p", "-e", "-N", "-t", target], {
    logResponse: false,
  });
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

/** Opens project persistence and records enough startup context to diagnose failures. */
async function openProjectRepository(): Promise<ProjectRepository> {
  try {
    const repository = await createJsonProjectRepository(PROJECT_STORE_PATH);
    const projects = await repository.listProjects();
    app.log.info(
      { projectStorePath: PROJECT_STORE_PATH, projectCount: projects.length },
      "project repository opened",
    );
    return repository;
  } catch (error) {
    app.log.fatal(
      { err: error, projectStorePath: PROJECT_STORE_PATH },
      "failed to open project repository",
    );
    throw error;
  }
}

const projectRepository = await openProjectRepository();

/** Resolves an allow-listed application definition from a public app ID. */
function findApplication(appId: string): AppDefinition | undefined {
  return APP_DEFINITIONS.find((application) => application.id === appId);
}

/** Projects an app definition to client-safe metadata, preserving action order. */
function publicApplication(application: AppDefinition) {
  return {
    id: application.id,
    title: application.title,
    actions: application.actions.map(({ id, label }) => ({ id, label })),
  };
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
      request.log.warn({ projectId: request.params.projectId }, "project not found");
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
      id: randomUUID(),
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
  const applications = APP_DEFINITIONS.map(publicApplication);
  app.log.debug({ appCount: applications.length }, "application catalog listed");
  return applications;
});

// Detail lookup makes directly addressed terminal routes independent of navigation state.
app.get<{ Params: { appId: string } }>("/apps/:appId", async (request, reply) => {
  const application = findApplication(request.params.appId);
  if (application === undefined) {
    request.log.warn({ appId: request.params.appId }, "application not found");
    return await reply.code(404).send();
  }

  request.log.debug({ appId: application.id }, "application retrieved");
  return publicApplication(application);
});

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

app.post<{ Params: { projectId: string; appId: string; actionId: string } }>(
  "/projects/:projectId/apps/:appId/actions/:actionId",
  async (request, reply) => {
    const project = await projectRepository.getProject(request.params.projectId);
    const application = findApplication(request.params.appId);
    // Resolve within the selected app so equal IDs may safely behave differently per app.
    const action = application?.actions.find(
      (candidate) => candidate.id === request.params.actionId,
    );
    if (project === undefined || application === undefined || action === undefined) {
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

    if (!(await appWindowExists(project, application))) {
      request.log.warn(
        { projectId: project.id, appId: application.id, actionId: action.id },
        "action requested for a stopped app",
      );
      return await reply.code(404).send();
    }

    // The route selects only configured suffix arguments; the command and pane stay private.
    await tmux(
      "send-keys",
      "-t",
      paneTarget(project, application),
      ...action.sendKeysArgs,
    );
    request.log.info(
      {
        projectId: project.id,
        appId: application.id,
        actionId: action.id,
        target: paneTarget(project, application),
      },
      "app action sent",
    );
    return await reply.code(204).send();
  },
);

try {
  const address = await app.listen({ host: AGENT_HOST, port: AGENT_PORT });
  app.log.info(
    { address, host: AGENT_HOST, port: AGENT_PORT, logLevel: AGENT_LOG_LEVEL },
    "Remote Deck agent started",
  );
} catch (error) {
  app.log.fatal({ err: error, host: AGENT_HOST, port: AGENT_PORT }, "agent failed to start");
  process.exitCode = 1;
}
