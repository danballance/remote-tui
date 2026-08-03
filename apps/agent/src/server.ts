/** Production composition root for the Remote Deck desktop agent. */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { createAgentApp, type TmuxExecutor } from "./app.js";
import {
  APPLICATION_CATALOG_PATH,
  loadApplicationCatalog,
} from "./applications.js";
import { createJsonProjectRepository } from "./projects.js";

const AGENT_HOST = "192.168.86.75";
const AGENT_PORT = 43_820;
/** Set to `debug` when tmux probes and snapshot metadata are needed. */
const AGENT_LOG_LEVEL = process.env.REMOTE_DECK_LOG_LEVEL ?? "info";
const PROJECT_STORE_PATH = fileURLToPath(
  new URL("../.data/projects.json", import.meta.url),
);

const execFileAsync = promisify(execFile);

/** Executes tmux directly, never through a shell. */
const executeTmux: TmuxExecutor = async (arguments_) => {
  const { stdout, stderr } = await execFileAsync("tmux", [...arguments_], {
    encoding: "utf8",
  });
  return { stdout, stderr };
};

async function startAgent(): Promise<void> {
  const applications = await loadApplicationCatalog();
  const projectRepository = await createJsonProjectRepository(PROJECT_STORE_PATH);
  const app = createAgentApp({
    applications,
    projectRepository,
    createProjectId: randomUUID,
    executeTmux,
    logLevel: AGENT_LOG_LEVEL,
  });

  app.log.info(
    {
      applicationCatalogPath: APPLICATION_CATALOG_PATH,
      appCount: applications.length,
    },
    "application catalog loaded",
  );
  app.log.info(
    {
      projectStorePath: PROJECT_STORE_PATH,
      projectCount: (await projectRepository.listProjects()).length,
    },
    "project repository opened",
  );

  const address = await app.listen({ host: AGENT_HOST, port: AGENT_PORT });
  app.log.info(
    { address, host: AGENT_HOST, port: AGENT_PORT, logLevel: AGENT_LOG_LEVEL },
    "Remote Deck agent started",
  );
}

try {
  await startAgent();
} catch (error) {
  console.error("Remote Deck agent failed to start", error);
  process.exitCode = 1;
}
