/** Lean Fastify adapter for projects, the application catalog, and runtime. */

import Fastify, { type FastifyInstance } from "fastify";

import type { CreateProjectRequest, Project } from "@remote-deck/contracts";

import {
  InvalidActionRequestError,
  parseActionRequestInput,
} from "./actions.js";
import {
  publicApplication,
  type ApplicationCatalog,
} from "./applications.js";
import type { ProjectRepository } from "./projects.js";
import type { ApplicationRuntime } from "./runtime.js";

/** Dependencies supplied by the production composition root or a unit test. */
export interface AgentAppOptions {
  readonly applicationCatalog: ApplicationCatalog;
  readonly applicationRuntime: ApplicationRuntime;
  readonly projectRepository: ProjectRepository;
  readonly createProjectId: () => string;
  readonly logLevel?: string;
  readonly server?: FastifyInstance;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCreateProjectRequest(
  body: unknown,
): CreateProjectRequest | undefined {
  if (!isRecord(body)) {
    return undefined;
  }
  const fields = Object.keys(body);
  if (
    fields.some((field) => field !== "name" && field !== "directory") ||
    typeof body.name !== "string" ||
    body.name.trim() === "" ||
    typeof body.directory !== "string" ||
    body.directory.trim() === ""
  ) {
    return undefined;
  }
  return { name: body.name, directory: body.directory };
}

/** Registers all agent routes without opening files, spawning tmux, or listening. */
export function createAgentApp({
  applicationCatalog,
  applicationRuntime,
  projectRepository,
  createProjectId,
  logLevel = "info",
  server,
}: AgentAppOptions): FastifyInstance {
  const app = server ?? Fastify({ logger: { level: logLevel } });

  app.get("/projects", async () => await projectRepository.listProjects());

  app.get<{ Params: { projectId: string } }>(
    "/projects/:projectId",
    async (request, reply) => {
      const project = await projectRepository.getProject(request.params.projectId);
      return project ?? (await reply.code(404).send());
    },
  );

  app.post<{ Body: unknown }>("/projects", async (request, reply) => {
    const body = parseCreateProjectRequest(request.body);
    if (body === undefined) {
      return await reply.code(400).send();
    }

    const project: Project = { id: createProjectId(), ...body };
    try {
      await projectRepository.addProject(project);
    } catch (error) {
      request.log.error(
        { err: error, projectId: project.id },
        "failed to persist project",
      );
      throw error;
    }
    request.log.info({ projectId: project.id }, "project created");
    return await reply.code(201).send(project);
  });

  app.get("/apps", async () =>
    applicationCatalog.listApplications().map(publicApplication),
  );

  app.get<{ Params: { appId: string } }>(
    "/apps/:appId",
    async (request, reply) => {
      const application = applicationCatalog.getApplication(request.params.appId);
      return application === undefined
        ? await reply.code(404).send()
        : publicApplication(application);
    },
  );

  app.post<{ Params: { projectId: string; appId: string } }>(
    "/projects/:projectId/apps/:appId/launch",
    async (request, reply) => {
      const project = await projectRepository.getProject(request.params.projectId);
      const application = applicationCatalog.getApplication(request.params.appId);
      if (project === undefined || application === undefined) {
        return await reply.code(404).send();
      }

      await applicationRuntime.launch(project, application);
      return await reply.code(204).send();
    },
  );

  app.get<{ Params: { projectId: string; appId: string } }>(
    "/projects/:projectId/apps/:appId/snapshot",
    async (request, reply) => {
      const project = await projectRepository.getProject(request.params.projectId);
      const application = applicationCatalog.getApplication(request.params.appId);
      if (project === undefined || application === undefined) {
        return await reply.code(404).send();
      }

      return await applicationRuntime.snapshot(project, application);
    },
  );

  app.post<{
    Params: { projectId: string; appId: string; actionId: string };
    Body: unknown;
  }>(
    "/projects/:projectId/apps/:appId/actions/:actionId",
    async (request, reply) => {
      const { projectId, appId, actionId } = request.params;
      const project = await projectRepository.getProject(projectId);
      const application = applicationCatalog.getApplication(appId);
      const action = applicationCatalog.getAction(appId, actionId);
      if (
        project === undefined ||
        application === undefined ||
        action === undefined
      ) {
        return await reply.code(404).send();
      }

      let input: string | undefined;
      try {
        input = parseActionRequestInput(action, request.body);
      } catch (error) {
        if (!(error instanceof InvalidActionRequestError)) {
          throw error;
        }
        request.log.warn(
          { projectId, appId, actionId, reason: error.message },
          "invalid app action request",
        );
        return await reply.code(400).send();
      }

      const running = await applicationRuntime.runAction(
        project,
        application,
        action,
        input,
      );
      return running
        ? await reply.code(204).send()
        : await reply.code(404).send();
    },
  );

  return app;
}
