import assert from "node:assert/strict";
import test from "node:test";

import type { TerminalFrame } from "@remote-deck/contracts";

import { createAgentApp } from "../src/app.js";
import {
  StaticApplicationCatalog,
  type AppActionDefinition,
  type AppDefinition,
} from "../src/applications.js";
import type { Project, ProjectRepository } from "../src/projects.js";
import type { ApplicationRuntime } from "../src/runtime.js";

const project: Project = {
  id: "project-1",
  name: "Remote Deck",
  directory: "/work/remote-deck",
};
const application: AppDefinition = {
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
};
const frame: TerminalFrame = {
  running: true,
  columns: 120,
  rows: 35,
  ansi: "screen",
  cursorX: 1,
  cursorY: 2,
  cursorVisible: true,
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

class FakeApplicationRuntime implements ApplicationRuntime {
  readonly launches: { project: Project; application: AppDefinition }[] = [];
  readonly snapshots: { project: Project; application: AppDefinition }[] = [];
  readonly actions: {
    project: Project;
    application: AppDefinition;
    action: AppActionDefinition;
    input: string | undefined;
  }[] = [];
  actionResult = true;

  async launch(project_: Project, application_: AppDefinition): Promise<void> {
    this.launches.push({ project: project_, application: application_ });
  }

  async snapshot(
    project_: Project,
    application_: AppDefinition,
  ): Promise<TerminalFrame> {
    this.snapshots.push({ project: project_, application: application_ });
    return frame;
  }

  async runAction(
    project_: Project,
    application_: AppDefinition,
    action: AppActionDefinition,
    input: string | undefined,
  ): Promise<boolean> {
    this.actions.push({
      project: project_,
      application: application_,
      action,
      input,
    });
    return this.actionResult;
  }
}

function harness(initialProjects: readonly Project[] = [project]) {
  const repository = new MemoryProjectRepository(initialProjects);
  const runtime = new FakeApplicationRuntime();
  const app = createAgentApp({
    applicationCatalog: new StaticApplicationCatalog([application]),
    applicationRuntime: runtime,
    projectRepository: repository,
    createProjectId: () => "generated-id",
    logLevel: "silent",
  });
  return { app, repository, runtime };
}

test("lists, retrieves, creates, and validates projects", async (context) => {
  const { app, repository } = harness();
  context.after(async () => await app.close());

  const listed = await app.inject({ method: "GET", url: "/projects" });
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(listed.json(), [project]);

  const retrieved = await app.inject({
    method: "GET",
    url: "/projects/project-1",
  });
  assert.equal(retrieved.statusCode, 200);
  assert.deepEqual(retrieved.json(), project);
  assert.equal(
    (await app.inject({ method: "GET", url: "/projects/missing" })).statusCode,
    404,
  );

  const created = await app.inject({
    method: "POST",
    url: "/projects",
    payload: { name: "New", directory: "/work/new" },
  });
  assert.equal(created.statusCode, 201);
  assert.deepEqual(created.json(), {
    id: "generated-id",
    name: "New",
    directory: "/work/new",
  });
  assert.equal(repository.projects.length, 2);

  for (const payload of [
    undefined,
    {},
    { name: "", directory: "/work" },
    { name: "Name", directory: " " },
    { name: "Name", directory: "/work", extra: true },
  ]) {
    const response = await app.inject({
      method: "POST",
      url: "/projects",
      ...(payload === undefined ? {} : { payload }),
    });
    assert.equal(response.statusCode, 400);
  }
});

test("surfaces repository write failures", async (context) => {
  const { app, repository } = harness([]);
  context.after(async () => await app.close());
  repository.addError = new Error("disk full");

  const response = await app.inject({
    method: "POST",
    url: "/projects",
    payload: { name: "New", directory: "/work/new" },
  });
  assert.equal(response.statusCode, 500);
});

test("serves public catalog entries without private commands", async (context) => {
  const { app } = harness();
  context.after(async () => await app.close());

  const listed = await app.inject({ method: "GET", url: "/apps" });
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(listed.json(), [
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
  assert.equal(listed.body.includes("exec demo"), false);

  assert.equal(
    (await app.inject({ method: "GET", url: "/apps/demo" })).statusCode,
    200,
  );
  assert.equal(
    (await app.inject({ method: "GET", url: "/apps/missing" })).statusCode,
    404,
  );
});

test("delegates launch and snapshot lifecycle operations", async (context) => {
  const { app, runtime } = harness();
  context.after(async () => await app.close());

  const launch = await app.inject({
    method: "POST",
    url: "/projects/project-1/apps/demo/launch",
  });
  assert.equal(launch.statusCode, 204);
  assert.deepEqual(runtime.launches, [{ project, application }]);

  const snapshot = await app.inject({
    method: "GET",
    url: "/projects/project-1/apps/demo/snapshot",
  });
  assert.equal(snapshot.statusCode, 200);
  assert.deepEqual(snapshot.json(), frame);
  assert.deepEqual(runtime.snapshots, [{ project, application }]);

  for (const url of [
    "/projects/missing/apps/demo/launch",
    "/projects/project-1/apps/missing/launch",
    "/projects/missing/apps/demo/snapshot",
    "/projects/project-1/apps/missing/snapshot",
  ]) {
    const response = await app.inject({
      method: url.endsWith("launch") ? "POST" : "GET",
      url,
    });
    assert.equal(response.statusCode, 404);
  }
});

test("validates and delegates app-scoped actions", async (context) => {
  const { app, runtime } = harness();
  context.after(async () => await app.close());

  const immediate = await app.inject({
    method: "POST",
    url: "/projects/project-1/apps/demo/actions/up",
  });
  assert.equal(immediate.statusCode, 204);
  assert.equal(runtime.actions[0]?.input, undefined);

  const input = await app.inject({
    method: "POST",
    url: "/projects/project-1/apps/demo/actions/commit",
    payload: { input: "  fix routes  " },
  });
  assert.equal(input.statusCode, 204);
  assert.equal(runtime.actions[1]?.input, "fix routes");

  const invalid = await app.inject({
    method: "POST",
    url: "/projects/project-1/apps/demo/actions/commit",
    payload: {},
  });
  assert.equal(invalid.statusCode, 400);

  for (const url of [
    "/projects/missing/apps/demo/actions/up",
    "/projects/project-1/apps/missing/actions/up",
    "/projects/project-1/apps/demo/actions/missing",
  ]) {
    assert.equal(
      (await app.inject({ method: "POST", url })).statusCode,
      404,
    );
  }

  runtime.actionResult = false;
  const stopped = await app.inject({
    method: "POST",
    url: "/projects/project-1/apps/demo/actions/up",
  });
  assert.equal(stopped.statusCode, 404);
});
