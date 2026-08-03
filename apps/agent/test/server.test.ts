import assert from "node:assert/strict";
import test from "node:test";

import type { RemoteDeckConfig } from "@remote-deck/config";

import type { AppDefinition } from "../src/applications.js";
import type { Project, ProjectRepository } from "../src/projects.js";
import { startAgent, type AgentServerDependencies } from "../src/server.js";

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

test("composes paths, logging, IDs, and listen address from config", async (context) => {
  const config: RemoteDeckConfig = {
    agent: {
      protocol: "https",
      host: "127.0.0.7",
      port: 49_876,
      logLevel: "silent",
      applicationCatalogPath: "/config/catalog.yaml",
      projectStorePath: "/state/projects.json",
    },
    tmux: {
      sessionPrefix: "configured-",
      terminal: { columns: 88, rows: 24 },
    },
    mobile: {
      refreshDelayMs: 5,
      terminal: { fontSize: 8, maxFittedFontSize: 30 },
    },
  };
  const repository = new MemoryProjectRepository();
  const applications: readonly AppDefinition[] = [];
  const openedPaths: string[] = [];
  let listenOptions: { readonly host: string; readonly port: number } | undefined;
  const dependencies: AgentServerDependencies = {
    loadApplications: async (path) => {
      openedPaths.push(path);
      return applications;
    },
    openProjectRepository: async (path) => {
      openedPaths.push(path);
      return repository;
    },
    createProjectId: () => "configured-id",
    executeTmux: async () => ({ stdout: "", stderr: "" }),
    listen: async (_app, options) => {
      listenOptions = options;
      return "https://127.0.0.7:49876";
    },
  };

  const app = await startAgent(config, dependencies);
  context.after(async () => app.close());

  assert.deepEqual(openedPaths, [
    "/config/catalog.yaml",
    "/state/projects.json",
  ]);
  assert.deepEqual(listenOptions, { host: "127.0.0.7", port: 49_876 });
  assert.equal(app.log.level, "silent");

  const response = await app.inject({
    method: "POST",
    url: "/projects",
    payload: { name: "Configured", directory: "/work/configured" },
  });
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().id, "configured-id");
});
