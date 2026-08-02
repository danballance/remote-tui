/**
 * Typed HTTP client for the desktop agent.
 *
 * This module is the mobile app's only knowledge of agent routes. Request logs
 * include method, path, status, and duration, but never bodies or terminal data.
 */

import type { TerminalFrame } from "../components/TerminalView";

const AGENT_URL = "http://192.168.86.75:43820";

/** Mobile representation of a persisted remote project. */
export interface Project {
  id: string;
  name: string;
  directory: string;
}

/** Public catalog entry; executable commands remain private to the agent. */
export interface RemoteApp {
  id: string;
  title: string;
}

/** Small allow-list of terminal actions currently exposed by the mobile UI. */
export type AppAction = "up" | "down";

/** Executes one agent request and records transport-level diagnostics. */
async function request(path: string, init?: RequestInit): Promise<Response> {
  const method = init?.method ?? "GET";
  const startedAt = Date.now();
  console.info("[agent] request started", { method, path });

  let response: Response;
  try {
    response = await fetch(`${AGENT_URL}${path}`, init);
  } catch (error) {
    console.error("[agent] request failed before receiving a response", {
      method,
      path,
      durationMs: Date.now() - startedAt,
      error,
    });
    throw error;
  }

  const responseContext = {
    method,
    path,
    status: response.status,
    durationMs: Date.now() - startedAt,
  };
  if (!response.ok) {
    console.error("[agent] request returned an error response", responseContext);
    throw new Error(`Agent request failed with status ${response.status}.`);
  }

  console.info("[agent] request completed", responseContext);
  return response;
}

/** Lists projects in the order returned by the repository. */
export async function listProjects(): Promise<Project[]> {
  const response = await request("/projects");
  return (await response.json()) as Project[];
}

/** Retrieves the project needed to label an app launcher screen. */
export async function getProject(projectId: string): Promise<Project> {
  const response = await request(`/projects/${projectId}`);
  return (await response.json()) as Project;
}

/** Registers an existing remote directory as a new project. */
export async function createProject(
  name: string,
  directory: string,
): Promise<Project> {
  const response = await request("/projects", {
    body: JSON.stringify({ name, directory }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  return (await response.json()) as Project;
}

/** Lists applications that the desktop agent allows clients to launch. */
export async function listApps(): Promise<RemoteApp[]> {
  const response = await request("/apps");
  return (await response.json()) as RemoteApp[];
}

/** Creates an app window or reconnects to the existing window without restarting it. */
export async function launchApp(projectId: string, appId: string): Promise<void> {
  await request(`/projects/${projectId}/apps/${appId}/launch`, { method: "POST" });
}

/** Retrieves a full terminal frame for one project's app window. */
export async function getSnapshot(
  projectId: string,
  appId: string,
): Promise<TerminalFrame> {
  const response = await request(`/projects/${projectId}/apps/${appId}/snapshot`);
  return (await response.json()) as TerminalFrame;
}

/** Sends one allow-listed key action to the app window's primary pane. */
export async function runRemoteAction(
  projectId: string,
  appId: string,
  action: AppAction,
): Promise<void> {
  await request(`/projects/${projectId}/apps/${appId}/actions/${action}`, {
    method: "POST",
  });
}
