import assert from "node:assert/strict";
import test from "node:test";

import type { RemoteDeckConfig } from "@remote-deck/config";

import {
  createAgentApp,
  type AgentAppOptions,
  type TmuxExecutor,
} from "../src/app.js";
import type { AppDefinition } from "../src/applications.js";
import type { Project, ProjectRepository } from "../src/projects.js";

const project: Project = {
  id: "project-1",
  name: "Remote Deck",
  directory: "/work/remote-deck",
};

const applications: readonly AppDefinition[] = [
  {
    id: "demo",
    title: "Demo",
    command: "exec demo",
    actions: [
      { id: "up", label: "Up", sendKeysArgs: ["Up"] },
      {
        id: "commit",
        label: "Commit",
        sendKeysArgs: ["c"],
        input: {
          type: "text",
          label: "Commit message",
          required: true,
          maxLength: 80,
        },
        sendKeysAfterInputArgs: ["Enter"],
      },
    ],
  },
];

const config: RemoteDeckConfig = {
  agent: {
    protocol: "http",
    host: "127.0.0.1",
    port: 49_001,
    logLevel: "silent",
    applicationCatalogPath: "/test/apps.yaml",
    projectStorePath: "/test/projects.json",
  },
  tmux: {
    sessionPrefix: "test-deck-",
    terminal: { columns: 91, rows: 27 },
  },
  mobile: {
    refreshDelayMs: 7,
    terminal: { fontSize: 11, maxFittedFontSize: 37 },
  },
};

class MemoryProjectRepository implements ProjectRepository {
  readonly projects: Project[];
  addError: Error | undefined;

  constructor(initialProjects: readonly Project[] = [project]) {
    this.projects = [...initialProjects];
  }

  async listProjects(): Promise<Project[]> {
    return [...this.projects];
  }

  async getProject(projectId: string): Promise<Project | undefined> {
    return this.projects.find((candidate) => candidate.id === projectId);
  }

  async addProject(newProject: Project): Promise<void> {
    if (this.addError !== undefined) {
      throw this.addError;
    }
    this.projects.push(newProject);
  }
}

interface TestHarness {
  repository: MemoryProjectRepository;
  calls: string[][];
  options: AgentAppOptions;
}

function harness(
  execute?: (arguments_: readonly string[]) => Promise<{ stdout: string; stderr: string }>,
): TestHarness {
  const repository = new MemoryProjectRepository();
  const calls: string[][] = [];
  const executeTmux: TmuxExecutor = async (arguments_) => {
    calls.push([...arguments_]);
    return execute === undefined
      ? { stdout: "", stderr: "" }
      : await execute(arguments_);
  };
  return {
    repository,
    calls,
    options: {
      applications,
      config,
      projectRepository: repository,
      createProjectId: () => "generated-id",
      executeTmux,
    },
  };
}

test("serves project and public application routes", async (context) => {
  const testHarness = harness();
  const app = createAgentApp(testHarness.options);
  context.after(async () => app.close());

  const projectList = await app.inject({ method: "GET", url: "/projects" });
  assert.equal(projectList.statusCode, 200);
  assert.deepEqual(projectList.json(), [project]);

  const projectDetail = await app.inject({
    method: "GET",
    url: `/projects/${project.id}`,
  });
  assert.equal(projectDetail.statusCode, 200);
  assert.deepEqual(projectDetail.json(), project);
  assert.equal(
    (await app.inject({ method: "GET", url: "/projects/missing" })).statusCode,
    404,
  );

  const appList = await app.inject({ method: "GET", url: "/apps" });
  assert.equal(appList.statusCode, 200);
  assert.deepEqual(appList.json(), [
    {
      id: "demo",
      title: "Demo",
      actions: [
        { id: "up", label: "Up" },
        {
          id: "commit",
          label: "Commit",
          input: {
            type: "text",
            label: "Commit message",
            required: true,
            maxLength: 80,
          },
        },
      ],
    },
  ]);
  assert.equal(appList.body.includes("exec demo"), false);
  assert.equal(appList.body.includes("sendKeysArgs"), false);

  const appDetail = await app.inject({ method: "GET", url: "/apps/demo" });
  assert.deepEqual(appDetail.json(), appList.json()[0]);
  assert.equal(
    (await app.inject({ method: "GET", url: "/apps/missing" })).statusCode,
    404,
  );
});

test("creates and persists projects with the injected ID generator", async (context) => {
  const testHarness = harness();
  const app = createAgentApp(testHarness.options);
  context.after(async () => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/projects",
    payload: { name: "New project", directory: "/work/new" },
  });

  const expected = {
    id: "generated-id",
    name: "New project",
    directory: "/work/new",
  };
  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.json(), expected);
  assert.deepEqual(testHarness.repository.projects, [project, expected]);
});

test("returns an internal error when project persistence fails", async (context) => {
  const testHarness = harness();
  testHarness.repository.addError = new Error("disk unavailable");
  const app = createAgentApp(testHarness.options);
  context.after(async () => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/projects",
    payload: { name: "New project", directory: "/work/new" },
  });

  assert.equal(response.statusCode, 500);
  assert.equal(testHarness.repository.projects.length, 1);
});

test("returns 404 for launch, snapshot, and action targets outside the allow-list", async (context) => {
  const testHarness = harness();
  const app = createAgentApp(testHarness.options);
  context.after(async () => app.close());

  for (const request of [
    { method: "POST" as const, url: "/projects/missing/apps/demo/launch" },
    { method: "POST" as const, url: "/projects/project-1/apps/missing/launch" },
    { method: "GET" as const, url: "/projects/missing/apps/demo/snapshot" },
    { method: "GET" as const, url: "/projects/project-1/apps/missing/snapshot" },
    {
      method: "POST" as const,
      url: "/projects/project-1/apps/demo/actions/missing",
    },
  ]) {
    const response = await app.inject(request);
    assert.equal(response.statusCode, 404, request.url);
  }
  assert.deepEqual(testHarness.calls, []);
});

test("creates the first app as a fixed-size project session", async (context) => {
  const testHarness = harness(async (arguments_) => {
    if (arguments_[0] === "has-session") {
      throw new Error("missing session");
    }
    return { stdout: "", stderr: "" };
  });
  const app = createAgentApp(testHarness.options);
  context.after(async () => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/projects/project-1/apps/demo/launch",
  });

  assert.equal(response.statusCode, 204);
  assert.deepEqual(testHarness.calls, [
    ["has-session", "-t", "test-deck-project-1"],
    ["has-session", "-t", "test-deck-project-1"],
    [
      "new-session",
      "-d",
      "-x",
      "91",
      "-y",
      "27",
      "-s",
      "test-deck-project-1",
      "-n",
      "demo",
      "-c",
      "/work/remote-deck",
      "exec demo",
    ],
  ]);
});

test("creates a sibling app window when the session already exists", async (context) => {
  const testHarness = harness(async (arguments_) => ({
    stdout: arguments_[0] === "list-windows" ? "other\n" : "",
    stderr: "",
  }));
  const app = createAgentApp(testHarness.options);
  context.after(async () => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/projects/project-1/apps/demo/launch",
  });

  assert.equal(response.statusCode, 204);
  assert.deepEqual(testHarness.calls, [
    ["has-session", "-t", "test-deck-project-1"],
    [
      "list-windows",
      "-t",
      "test-deck-project-1",
      "-F",
      "#{window_name}",
    ],
    ["has-session", "-t", "test-deck-project-1"],
    [
      "new-window",
      "-d",
      "-t",
      "test-deck-project-1",
      "-n",
      "demo",
      "-c",
      "/work/remote-deck",
      "exec demo",
    ],
  ]);
});

test("reuses an existing app window without restarting it", async (context) => {
  const testHarness = harness(async (arguments_) => ({
    stdout: arguments_[0] === "list-windows" ? "other\ndemo\n" : "",
    stderr: "",
  }));
  const app = createAgentApp(testHarness.options);
  context.after(async () => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/projects/project-1/apps/demo/launch",
  });

  assert.equal(response.statusCode, 204);
  assert.equal(
    testHarness.calls.some(([command]) => command?.startsWith("new-") === true),
    false,
  );
});

test("returns a stable stopped snapshot without attempting capture", async (context) => {
  const testHarness = harness(async () => {
    throw new Error("missing session");
  });
  const app = createAgentApp(testHarness.options);
  context.after(async () => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/projects/project-1/apps/demo/snapshot",
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    running: false,
    columns: 91,
    rows: 27,
    ansi: "",
    cursorX: 0,
    cursorY: 0,
    cursorVisible: false,
  });
  assert.deepEqual(testHarness.calls, [
    ["has-session", "-t", "test-deck-project-1"],
  ]);
});

test("captures ANSI content and terminal metadata from the exact app pane", async (context) => {
  const testHarness = harness(async (arguments_) => {
    switch (arguments_[0]) {
      case "list-windows":
        return { stdout: "demo\n", stderr: "" };
      case "capture-pane":
        return { stdout: "\u001b[31mHello\u001b[0m\n", stderr: "" };
      case "display-message":
        return { stdout: "132\t41\t7\t9\t1\n", stderr: "" };
      default:
        return { stdout: "", stderr: "" };
    }
  });
  const app = createAgentApp(testHarness.options);
  context.after(async () => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/projects/project-1/apps/demo/snapshot",
  });

  assert.deepEqual(response.json(), {
    running: true,
    columns: 132,
    rows: 41,
    ansi: "\u001b[31mHello\u001b[0m",
    cursorX: 7,
    cursorY: 9,
    cursorVisible: true,
  });
  assert.deepEqual(testHarness.calls.slice(-2), [
    [
      "capture-pane",
      "-p",
      "-e",
      "-N",
      "-t",
      "test-deck-project-1:demo.0",
    ],
    [
      "display-message",
      "-p",
      "-t",
      "test-deck-project-1:demo.0",
      "#{pane_width}\t#{pane_height}\t#{cursor_x}\t#{cursor_y}\t#{cursor_flag}",
    ],
  ]);
});

test("rejects malformed and stopped actions before sending keys", async (context) => {
  const malformedHarness = harness();
  const malformedApp = createAgentApp(malformedHarness.options);
  context.after(async () => malformedApp.close());
  const malformed = await malformedApp.inject({
    method: "POST",
    url: "/projects/project-1/apps/demo/actions/commit",
    payload: { input: "   " },
  });
  assert.equal(malformed.statusCode, 400);
  assert.deepEqual(malformedHarness.calls, []);

  const stoppedHarness = harness(async () => {
    throw new Error("missing session");
  });
  const stoppedApp = createAgentApp(stoppedHarness.options);
  context.after(async () => stoppedApp.close());
  const stopped = await stoppedApp.inject({
    method: "POST",
    url: "/projects/project-1/apps/demo/actions/up",
  });
  assert.equal(stopped.statusCode, 404);
  assert.deepEqual(stoppedHarness.calls, [
    ["has-session", "-t", "test-deck-project-1"],
  ]);
});

test("sends immediate and input actions to a running pane in exact order", async (context) => {
  const testHarness = harness(async (arguments_) => ({
    stdout: arguments_[0] === "list-windows" ? "demo\n" : "",
    stderr: "",
  }));
  const app = createAgentApp(testHarness.options);
  context.after(async () => app.close());

  const immediate = await app.inject({
    method: "POST",
    url: "/projects/project-1/apps/demo/actions/up",
  });
  assert.equal(immediate.statusCode, 204);
  assert.deepEqual(testHarness.calls.slice(-1), [
    ["send-keys", "-t", "test-deck-project-1:demo.0", "Up"],
  ]);

  testHarness.calls.length = 0;
  const input = await app.inject({
    method: "POST",
    url: "/projects/project-1/apps/demo/actions/commit",
    payload: { input: "  fix: exact order  " },
  });
  assert.equal(input.statusCode, 204);
  assert.deepEqual(testHarness.calls, [
    ["has-session", "-t", "test-deck-project-1"],
    [
      "list-windows",
      "-t",
      "test-deck-project-1",
      "-F",
      "#{window_name}",
    ],
    ["send-keys", "-t", "test-deck-project-1:demo.0", "c"],
    [
      "send-keys",
      "-t",
      "test-deck-project-1:demo.0",
      "-l",
      "--",
      "fix: exact order",
    ],
    ["send-keys", "-t", "test-deck-project-1:demo.0", "Enter"],
  ]);
});

test("replaces sensitive tmux failures without exposing private input", async (context) => {
  const privateInput = "private commit message";
  const testHarness = harness(async (arguments_) => {
    if (arguments_.includes(privateInput)) {
      throw Object.assign(new Error(`tmux ${privateInput}`), {
        code: 1,
        killed: false,
        stderr: privateInput,
      });
    }
    return {
      stdout: arguments_[0] === "list-windows" ? "demo\n" : "",
      stderr: "",
    };
  });
  const app = createAgentApp(testHarness.options);
  context.after(async () => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/projects/project-1/apps/demo/actions/commit",
    payload: { input: privateInput },
  });

  assert.equal(response.statusCode, 500);
  assert.equal(response.body.includes(privateInput), false);
  assert.match(response.body, /tmux failed while sending private action input/);
});
