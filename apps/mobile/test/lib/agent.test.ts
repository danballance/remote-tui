import assert from "node:assert/strict";
import test from "node:test";

import {
  createProject,
  getApp,
  getProject,
  getSnapshot,
  launchApp,
  listApps,
  listProjects,
  runRemoteAction,
} from "../../lib/agent.js";

const AGENT_URL = "http://127.0.0.9:4567";

interface FetchCall {
  input: string | URL | Request;
  init: RequestInit | undefined;
}

type FetchHandler = (call: FetchCall) => Promise<Response>;

async function withMockedClient<Result>(
  handler: FetchHandler,
  operation: (calls: FetchCall[], logs: unknown[][]) => Promise<Result>,
): Promise<Result> {
  const originalFetch = globalThis.fetch;
  const originalInfo = console.info;
  const originalError = console.error;
  const calls: FetchCall[] = [];
  const logs: unknown[][] = [];

  globalThis.fetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const call = { input, init };
    calls.push(call);
    return await handler(call);
  };
  console.info = (...data: unknown[]): void => {
    logs.push(["info", ...data]);
  };
  console.error = (...data: unknown[]): void => {
    logs.push(["error", ...data]);
  };

  try {
    return await operation(calls, logs);
  } finally {
    globalThis.fetch = originalFetch;
    console.info = originalInfo;
    console.error = originalError;
  }
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("maps every read endpoint and returns its parsed agent payload", async () => {
  const project = {
    id: "project-1",
    name: "Remote Deck",
    directory: "/work/remote-deck",
  };
  const application = {
    id: "demo",
    title: "Demo",
    actions: [{ id: "up", label: "Up" }],
  };
  const snapshot = {
    running: true,
    columns: 120,
    rows: 35,
    ansi: "screen",
    cursorX: 2,
    cursorY: 3,
    cursorVisible: true,
  };

  await withMockedClient(
    async ({ input }) => {
      switch (new URL(String(input)).pathname) {
        case "/projects":
          return jsonResponse([project]);
        case "/projects/project-1":
          return jsonResponse(project);
        case "/apps":
          return jsonResponse([application]);
        case "/apps/demo":
          return jsonResponse(application);
        case "/projects/project-1/apps/demo/snapshot":
          return jsonResponse(snapshot);
        default:
          return new Response(null, { status: 404 });
      }
    },
    async (calls) => {
      assert.deepEqual(await listProjects(), [project]);
      assert.deepEqual(await getProject("project-1"), project);
      assert.deepEqual(await listApps(), [application]);
      assert.deepEqual(await getApp("demo"), application);
      assert.deepEqual(await getSnapshot("project-1", "demo"), snapshot);

      assert.deepEqual(
        calls.map(({ input, init }) => ({ url: String(input), init })),
        [
          { url: `${AGENT_URL}/projects`, init: undefined },
          { url: `${AGENT_URL}/projects/project-1`, init: undefined },
          { url: `${AGENT_URL}/apps`, init: undefined },
          { url: `${AGENT_URL}/apps/demo`, init: undefined },
          {
            url: `${AGENT_URL}/projects/project-1/apps/demo/snapshot`,
            init: undefined,
          },
        ],
      );
    },
  );
});

test("maps project creation, launch, and both action request shapes", async () => {
  const createdProject = {
    id: "created",
    name: "Created project",
    directory: "/work/created",
  };

  await withMockedClient(
    async ({ input }) =>
      new URL(String(input)).pathname === "/projects"
        ? jsonResponse(createdProject, 201)
        : new Response(null, { status: 204 }),
    async (calls) => {
      assert.deepEqual(
        await createProject("Created project", "/work/created"),
        createdProject,
      );
      await launchApp("project-1", "demo");
      await runRemoteAction("project-1", "demo", "up");
      await runRemoteAction("project-1", "demo", "commit", "fix: mobile client");

      assert.deepEqual(
        calls.map(({ input, init }) => ({ url: String(input), init })),
        [
          {
            url: `${AGENT_URL}/projects`,
            init: {
              body: JSON.stringify({
                name: "Created project",
                directory: "/work/created",
              }),
              headers: { "content-type": "application/json" },
              method: "POST",
            },
          },
          {
            url: `${AGENT_URL}/projects/project-1/apps/demo/launch`,
            init: { method: "POST" },
          },
          {
            url: `${AGENT_URL}/projects/project-1/apps/demo/actions/up`,
            init: { method: "POST" },
          },
          {
            url: `${AGENT_URL}/projects/project-1/apps/demo/actions/commit`,
            init: {
              method: "POST",
              body: JSON.stringify({ input: "fix: mobile client" }),
              headers: { "content-type": "application/json" },
            },
          },
        ],
      );
    },
  );
});

test("turns a non-success response into a status-addressed error", async () => {
  await withMockedClient(
    async () => new Response(null, { status: 503 }),
    async (_calls, logs) => {
      await assert.rejects(
        () => listProjects(),
        /Agent request failed with status 503\./,
      );
      assert.match(JSON.stringify(logs), /request returned an error response/);
      assert.match(JSON.stringify(logs), /503/);
    },
  );
});

test("propagates network failures and records transport context", async () => {
  const networkError = new Error("network unavailable");

  await withMockedClient(
    async () => {
      throw networkError;
    },
    async (_calls, logs) => {
      await assert.rejects(
        () => getApp("demo"),
        (error: unknown) => error === networkError,
      );
      const diagnostics = JSON.stringify(logs);
      assert.match(diagnostics, /request failed before receiving a response/);
      assert.match(diagnostics, /\/apps\/demo/);
    },
  );
});

test("never includes action input or terminal contents in request diagnostics", async () => {
  const privateInput = "private commit message";
  const privateTerminal = "private terminal contents";

  await withMockedClient(
    async ({ input }) =>
      new URL(String(input)).pathname.endsWith("/snapshot")
        ? jsonResponse({
            running: true,
            columns: 120,
            rows: 35,
            ansi: privateTerminal,
            cursorX: 0,
            cursorY: 0,
            cursorVisible: false,
          })
        : new Response(null, { status: 204 }),
    async (_calls, logs) => {
      await runRemoteAction("project-1", "demo", "commit", privateInput);
      await getSnapshot("project-1", "demo");

      const diagnostics = JSON.stringify(logs);
      assert.equal(diagnostics.includes(privateInput), false);
      assert.equal(diagnostics.includes(privateTerminal), false);
      assert.match(diagnostics, /\/actions\/commit/);
      assert.match(diagnostics, /\/snapshot/);
    },
  );
});
