/** Production composition root for the Remote Deck desktop agent. */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { loadConfig, type RemoteDeckConfig } from "@remote-deck/config";
import type { FastifyInstance } from "fastify";

import { createAgentApp, type TmuxExecutor } from "./app.js";
import { loadApplicationCatalog, type AppDefinition } from "./applications.js";
import {
  createJsonProjectRepository,
  type ProjectRepository,
} from "./projects.js";

const execFileAsync = promisify(execFile);

/** Executes tmux directly, never through a shell. */
const executeTmux: TmuxExecutor = async (arguments_) => {
  const { stdout, stderr } = await execFileAsync("tmux", [...arguments_], {
    encoding: "utf8",
  });
  return { stdout, stderr };
};

/** Injectable startup dependencies used by production and composition tests. */
export interface AgentServerDependencies {
  loadApplications(path: string): Promise<readonly AppDefinition[]>;
  openProjectRepository(path: string): Promise<ProjectRepository>;
  createProjectId(): string;
  executeTmux: TmuxExecutor;
  listen(
    app: FastifyInstance,
    options: { readonly host: string; readonly port: number },
  ): Promise<string>;
}

const productionDependencies: AgentServerDependencies = {
  loadApplications: loadApplicationCatalog,
  openProjectRepository: createJsonProjectRepository,
  createProjectId: randomUUID,
  executeTmux,
  listen: async (app, options) => await app.listen(options),
};

/** Composes and starts the agent from one already validated configuration value. */
export async function startAgent(
  config: RemoteDeckConfig,
  dependencies: AgentServerDependencies = productionDependencies,
): Promise<FastifyInstance> {
  const applications = await dependencies.loadApplications(
    config.agent.applicationCatalogPath,
  );
  const projectRepository = await dependencies.openProjectRepository(
    config.agent.projectStorePath,
  );
  const app = createAgentApp({
    applications,
    config,
    projectRepository,
    createProjectId: dependencies.createProjectId,
    executeTmux: dependencies.executeTmux,
  });

  app.log.info(
    {
      applicationCatalogPath: config.agent.applicationCatalogPath,
      appCount: applications.length,
    },
    "application catalog loaded",
  );
  app.log.info(
    {
      projectStorePath: config.agent.projectStorePath,
      projectCount: (await projectRepository.listProjects()).length,
    },
    "project repository opened",
  );

  const address = await dependencies.listen(app, {
    host: config.agent.host,
    port: config.agent.port,
  });
  app.log.info(
    {
      address,
      host: config.agent.host,
      port: config.agent.port,
      logLevel: config.agent.logLevel,
    },
    "Remote Deck agent started",
  );
  return app;
}

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  pathToFileURL(entrypoint).href === import.meta.url
) {
  try {
    await startAgent(loadConfig());
  } catch (error) {
    console.error("Remote Deck agent failed to start", error);
    process.exitCode = 1;
  }
}
