/** Interface and HTTP implementation for the desktop agent. */

import type {
  ApplicationActionRequest,
  CreateProjectRequest,
  Project,
  PublicApplication,
  TerminalFrame,
} from "@remote-deck/contracts";

/** Mobile-facing boundary for every operation exposed by the agent. */
export interface AgentClient {
  listProjects(): Promise<Project[]>;
  getProject(projectId: string): Promise<Project>;
  createProject(name: string, directory: string): Promise<Project>;
  listApps(): Promise<PublicApplication[]>;
  getApp(appId: string): Promise<PublicApplication>;
  launchApp(projectId: string, appId: string): Promise<void>;
  getSnapshot(projectId: string, appId: string): Promise<TerminalFrame>;
  runAction(
    projectId: string,
    appId: string,
    actionId: string,
    input?: string,
  ): Promise<void>;
}

/** Fetch-based agent client with no dependency on React or terminal rendering. */
export class HttpAgentClient implements AgentClient {
  readonly #baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly fetch: typeof globalThis.fetch = globalThis.fetch,
  ) {
    this.#baseUrl = baseUrl.replace(/\/$/, "");
  }

  async listProjects(): Promise<Project[]> {
    return await this.getJson<Project[]>("/projects");
  }

  async getProject(projectId: string): Promise<Project> {
    return await this.getJson<Project>(`/projects/${projectId}`);
  }

  async createProject(name: string, directory: string): Promise<Project> {
    const body: CreateProjectRequest = { name, directory };
    return await this.getJson<Project>("/projects", {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
  }

  async listApps(): Promise<PublicApplication[]> {
    return await this.getJson<PublicApplication[]>("/apps");
  }

  async getApp(appId: string): Promise<PublicApplication> {
    return await this.getJson<PublicApplication>(`/apps/${appId}`);
  }

  async launchApp(projectId: string, appId: string): Promise<void> {
    await this.request(`/projects/${projectId}/apps/${appId}/launch`, {
      method: "POST",
    });
  }

  async getSnapshot(projectId: string, appId: string): Promise<TerminalFrame> {
    return await this.getJson<TerminalFrame>(
      `/projects/${projectId}/apps/${appId}/snapshot`,
    );
  }

  async runAction(
    projectId: string,
    appId: string,
    actionId: string,
    input?: string,
  ): Promise<void> {
    const init: RequestInit = { method: "POST" };
    if (input !== undefined) {
      const body: ApplicationActionRequest = { input };
      init.body = JSON.stringify(body);
      init.headers = { "content-type": "application/json" };
    }
    await this.request(
      `/projects/${projectId}/apps/${appId}/actions/${actionId}`,
      init,
    );
  }

  private async getJson<Result>(
    path: string,
    init?: RequestInit,
  ): Promise<Result> {
    const response = await this.request(path, init);
    return (await response.json()) as Result;
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const method = init?.method ?? "GET";
    let response: Response;
    try {
      response = await this.fetch(`${this.#baseUrl}${path}`, init);
    } catch (error) {
      console.error("[agent] request failed", { method, path, error });
      throw error;
    }
    if (!response.ok) {
      console.error("[agent] request returned an error response", {
        method,
        path,
        status: response.status,
      });
      throw new Error(`Agent request failed with status ${response.status}.`);
    }
    return response;
  }
}
