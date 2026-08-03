import assert from "node:assert/strict";
import test from "node:test";

import type { RemoteDeckConfig } from "@remote-deck/config";
import type { FastifyInstance } from "fastify";

import type { Project, ProjectRepository } from "../src/projects.js";
import {
  startAgent,
  type AgentServerDependencies,
} from "../src/server.js";

const config: RemoteDeckConfig = {
  agent: {
    host: "127.0.0.1",
    port: 49_001,
    logLevel: "silent",
    projectStorePath: "/test/projects.json",
  },
  tmux: {
    sessionPrefix: "test-deck-",
    terminal: { columns: 91, rows: 27 },
  },
};

class MemoryProjectRepository implements ProjectRepository {
  readonly projects: Project[] = [];

  async listProjects(): Promise<Project[]> {
    return [...this.projects];
  }

  async getProject(projectId: string): Promise<Project | undefined> {
    return this.projects.find((project) => project.id === projectId);
  }

  async addProject(project: Project): Promise<void> {
    this.projects.push(project);
  }
}

test("composes typed settings, static catalog, repository, and tmux runtime", async (context) => {
  const repository = new MemoryProjectRepository();
  const openedPaths: string[] = [];
  const tmuxCalls: string[][] = [];
  let listenedApp: FastifyInstance | undefined;
  let listenOptions: { readonly host: string; readonly port: number } | undefined;

  const dependencies: AgentServerDependencies = {
    openProjectRepository: async (path) => {
      openedPaths.push(path);
      return repository;
    },
    createProjectId: () => "generated-id",
    executeTmux: async (arguments_) => {
      tmuxCalls.push([...arguments_]);
      return { stdout: "%1\n", stderr: "" };
    },
    listen: async (app, options) => {
      listenedApp = app;
      listenOptions = options;
      return "http://127.0.0.1:49001";
    },
  };

  const app = await startAgent(config, dependencies);
  context.after(async () => await app.close());

  assert.equal(listenedApp, app);
  assert.deepEqual(openedPaths, ["/test/projects.json"]);
  assert.deepEqual(listenOptions, { host: "127.0.0.1", port: 49_001 });

  const apps = await app.inject({ method: "GET", url: "/apps" });
  assert.deepEqual(
    apps.json().map((application: { id: string }) => application.id),
    ["lazygit", "yazi", "pi"],
  );

  await app.inject({
    method: "POST",
    url: "/projects",
    payload: { name: "Project", directory: "/work/project" },
  });
  const launched = await app.inject({
    method: "POST",
    url: "/projects/generated-id/apps/lazygit/launch",
  });
  assert.equal(launched.statusCode, 204);
  assert.deepEqual(tmuxCalls, [
    [
      "display-message",
      "-p",
      "-t",
      "=test-deck-generated-id:lazygit.0",
      "#{pane_id}",
    ],
  ]);
});
