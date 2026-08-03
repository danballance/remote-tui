import assert from "node:assert/strict";
import test from "node:test";

import { HttpAgentClient } from "../../lib/agent.js";

const AGENT_URL = "http://127.0.0.9:4567";

interface FetchCall {
  input: string | URL | Request;
  init: RequestInit | undefined;
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function clientWith(
  handler: (call: FetchCall) => Promise<Response>,
): { client: HttpAgentClient; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const call = { input, init };
    calls.push(call);
    return await handler(call);
  };
  return {
    client: new HttpAgentClient(`${AGENT_URL}/`, fetch),
    calls,
  };
}

test("maps every read endpoint and returns parsed payloads", async () => {
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
  const { client, calls } = clientWith(async ({ input }) => {
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
  });

  assert.deepEqual(await client.listProjects(), [project]);
  assert.deepEqual(await client.getProject("project-1"), project);
  assert.deepEqual(await client.listApps(), [application]);
  assert.deepEqual(await client.getApp("demo"), application);
  assert.deepEqual(await client.getSnapshot("project-1", "demo"), snapshot);
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
});

test("maps project creation, launch, and both action request shapes", async () => {
  const createdProject = {
    id: "created",
    name: "Created project",
    directory: "/work/created",
  };
  const { client, calls } = clientWith(async ({ input }) =>
    new URL(String(input)).pathname === "/projects"
      ? jsonResponse(createdProject, 201)
      : new Response(null, { status: 204 }),
  );

  assert.deepEqual(
    await client.createProject("Created project", "/work/created"),
    createdProject,
  );
  await client.launchApp("project-1", "demo");
  await client.runAction("project-1", "demo", "up");
  await client.runAction("project-1", "demo", "commit", "fix: client");

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
          body: JSON.stringify({ input: "fix: client" }),
          headers: { "content-type": "application/json" },
        },
      },
    ],
  );
});

test("reports non-success responses without logging bodies", async () => {
  const originalError = console.error;
  const logs: unknown[][] = [];
  console.error = (...data: unknown[]) => logs.push(data);
  const { client } = clientWith(async () => new Response(null, { status: 503 }));

  try {
    await assert.rejects(
      () => client.listProjects(),
      /Agent request failed with status 503/,
    );
  } finally {
    console.error = originalError;
  }
  assert.match(JSON.stringify(logs), /error response/);
  assert.match(JSON.stringify(logs), /503/);
});

test("propagates and logs network failures", async () => {
  const networkError = new Error("network unavailable");
  const originalError = console.error;
  const logs: unknown[][] = [];
  console.error = (...data: unknown[]) => logs.push(data);
  const { client } = clientWith(async () => {
    throw networkError;
  });

  try {
    await assert.rejects(
      () => client.getApp("demo"),
      (error: unknown) => error === networkError,
    );
  } finally {
    console.error = originalError;
  }
  assert.match(JSON.stringify(logs), /request failed/);
  assert.match(JSON.stringify(logs), /\/apps\/demo/);
});
