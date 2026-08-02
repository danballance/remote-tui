import { execFile } from "node:child_process";
import { promisify } from "node:util";

import Fastify from "fastify";

const AGENT_HOST = "192.168.86.75";
const AGENT_PORT = 43_820;
const REPOSITORY = "/home/anoni/Code/fullstack/remote-tui";
const SESSION = "remote-deck";
const TARGET = `${SESSION}:lazygit.0`;
const TERMINAL_COLUMNS = 80;
const TERMINAL_ROWS = 20;

const execFileAsync = promisify(execFile);
const app = Fastify({ logger: true });

interface Snapshot {
  running: boolean;
  lines: string[];
}

interface ViewDefinition {
  snapshot(): Promise<Snapshot>;
  actions: Record<string, () => Promise<void>>;
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

async function tmux(...args: string[]): Promise<string> {
  // `execFile` invokes tmux directly, so each item remains a distinct argument rather than being
  // interpolated by a shell. The same array is logged to show the exact command being executed.
  const command = ["tmux", ...args];

  try {
    const { stdout, stderr } = await execFileAsync("tmux", args, { encoding: "utf8" });
    app.log.info({ command, response: { stdout, stderr } }, "tmux command completed");
    return stdout;
  } catch (error) {
    app.log.error(
      { err: error, command, response: commandResponse(error) },
      "tmux command failed",
    );
    throw error;
  }
}

async function sessionExists(): Promise<boolean> {
  try {
    // `has-session` succeeds when the session exists; `-t` names the target session to inspect.
    await tmux("has-session", "-t", SESSION);
    return true;
  } catch {
    return false;
  }
}

async function openOrRestartLazygit(): Promise<void> {
  if (await sessionExists()) {
    // `kill-session` removes the existing session; `-t` selects the session to remove.
    await tmux("kill-session", "-t", SESSION);
  }

  await tmux(
    // `new-session` creates the tmux session that owns the LazyGit terminal.
    "new-session",
    // `-d` starts it detached because the mobile client only captures and controls the pane.
    "-d",
    // `-x` sets the landscape terminal grid width in columns.
    "-x",
    String(TERMINAL_COLUMNS),
    // `-y` sets the landscape terminal grid height in rows.
    "-y",
    String(TERMINAL_ROWS),
    // `-s` assigns the session name used by later tmux commands.
    "-s",
    SESSION,
    // `-n` names the first window, which is also part of TARGET.
    "-n",
    "lazygit",
    // `-c` sets the working directory before starting the window command.
    "-c",
    REPOSITORY,
    // The final argument is the window command. `exec` makes LazyGit the pane's main process.
    "exec lazygit",
  );
}

async function lazygitSnapshot(): Promise<Snapshot> {
  if (!(await sessionExists())) {
    return { running: false, lines: [] };
  }

  // `capture-pane` reads the visible pane; `-p` prints it to stdout and `-t` selects the pane.
  const output = await tmux("capture-pane", "-p", "-t", TARGET);
  return {
    running: true,
    lines: output.replace(/\n$/, "").split("\n"),
  };
}

const views: Record<string, ViewDefinition> = {
  lazygit: {
    snapshot: lazygitSnapshot,
    actions: {
      open: openOrRestartLazygit,
      up: async () => {
        // `send-keys` injects a key; `-t` selects the pane and `Up` is tmux's Up-arrow key name.
        await tmux("send-keys", "-t", TARGET, "Up");
      },
      down: async () => {
        // `send-keys` injects a key; `-t` selects the pane and `Down` is the Down-arrow key name.
        await tmux("send-keys", "-t", TARGET, "Down");
      },
    },
  },
};

app.get<{ Params: { view: string } }>("/views/:view/snapshot", async (request, reply) => {
  const view = views[request.params.view];
  if (view === undefined) {
    return await reply.code(404).send();
  }

  return await view.snapshot();
});

app.post<{ Params: { view: string; action: string } }>(
  "/views/:view/actions/:action",
  async (request, reply) => {
    const action = views[request.params.view]?.actions[request.params.action];
    if (action === undefined) {
      return await reply.code(404).send();
    }

    await action();
    return await reply.code(204).send();
  },
);

try {
  await app.listen({ host: AGENT_HOST, port: AGENT_PORT });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
