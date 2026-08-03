/** Production composition root for the Remote Deck desktop agent. */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { remoteDeckConfig, type RemoteDeckConfig } from "@remote-deck/config";
import Fastify, { type FastifyInstance } from "fastify";

import { createAgentApp } from "./app.js";
import { createApplicationCatalog } from "./applications.js";
import {
  createJsonProjectRepository,
  type ProjectRepository,
} from "./projects.js";
import {
  TmuxApplicationRuntime,
  type TmuxExecutor,
} from "./runtime.js";

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
  openProjectRepository(path: string): Promise<ProjectRepository>;
  createProjectId(): string;
  executeTmux: TmuxExecutor;
  listen(
    app: FastifyInstance,
    options: { readonly host: string; readonly port: number },
  ): Promise<string>;
}

const productionDependencies: AgentServerDependencies = {
  openProjectRepository: createJsonProjectRepository,
  createProjectId: randomUUID,
  executeTmux,
  listen: async (app, options) => await app.listen(options),
};

/** Composes and starts the agent from trusted typed settings. */
export async function startAgent(
  config: RemoteDeckConfig,
  dependencies: AgentServerDependencies = productionDependencies,
): Promise<FastifyInstance> {
  const projectRepository = await dependencies.openProjectRepository(
    config.agent.projectStorePath,
  );
  const applicationCatalog = createApplicationCatalog();
  const server = Fastify({ logger: { level: config.agent.logLevel } });
  const applicationRuntime = new TmuxApplicationRuntime(
    config.tmux,
    dependencies.executeTmux,
    server.log,
  );
  const app = createAgentApp({
    applicationCatalog,
    applicationRuntime,
    projectRepository,
    createProjectId: dependencies.createProjectId,
    server,
  });

  app.log.info(
    {
      appCount: applicationCatalog.listApplications().length,
      projectStorePath: config.agent.projectStorePath,
      projectCount: (await projectRepository.listProjects()).length,
    },
    "agent resources ready",
  );

  const address = await dependencies.listen(app, {
    host: config.agent.host,
    port: config.agent.port,
  });
  app.log.info(
    { address, host: config.agent.host, port: config.agent.port },
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
    await startAgent(remoteDeckConfig);
  } catch (error) {
    console.error("Remote Deck agent failed to start", error);
    process.exitCode = 1;
  }
}
