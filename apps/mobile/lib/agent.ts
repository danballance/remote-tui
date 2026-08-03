/**
 * Typed HTTP client for the desktop agent.
 *
 * This module is the mobile app's only knowledge of agent routes. Request logs
 * include method, path, status, and duration, but never bodies or terminal data.
 */

import type { TerminalFrame } from "../components/TerminalView";
import { getMobileConfig } from "./config";

/** Mobile representation of a persisted remote project. */
export interface Project {
  id: string;
  name: string;
  directory: string;
}

/** Client-safe action metadata used for route selection and button rendering. */
export interface RemoteAppActionTextInput {
  type: "text";
  label: string;
  placeholder?: string;
  required: boolean;
  maxLength: number;
}

/** Client-safe action metadata used for route selection and button rendering. */
export interface RemoteAppAction {
  /** Stable identifier sent back to the app-scoped action route. */
  id: string;
  /** Agent-provided text displayed and announced by the mobile control. */
  label: string;
  /** Optional prompt metadata; executable input behavior remains agent-owned. */
  input?: RemoteAppActionTextInput;
}

/** Public catalog entry; executable commands and tmux arguments stay on the agent. */
export interface RemoteApp {
  id: string;
  title: string;
  /** Controls appear in this agent-defined order on the terminal screen. */
  actions: RemoteAppAction[];
}

/** Executes one agent request and records transport-level diagnostics. */
async function request(path: string, init?: RequestInit): Promise<Response> {
  const method = init?.method ?? "GET";
  const startedAt = Date.now();
  console.info("[agent] request started", { method, path });

  let response: Response;
  try {
    response = await fetch(`${getMobileConfig().agentUrl}${path}`, init);
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

/** Lists launchable applications with each app's ordered public actions. */
export async function listApps(): Promise<RemoteApp[]> {
  const response = await request("/apps");
  return (await response.json()) as RemoteApp[];
}

/** Retrieves canonical metadata for a directly addressed terminal screen. */
export async function getApp(appId: string): Promise<RemoteApp> {
  const response = await request(`/apps/${appId}`);
  return (await response.json()) as RemoteApp;
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

/** Requests an app-owned action; the agent resolves its private tmux arguments. */
export async function runRemoteAction(
  projectId: string,
  appId: string,
  actionId: string,
  input?: string,
): Promise<void> {
  const init: RequestInit = { method: "POST" };
  if (input !== undefined) {
    init.body = JSON.stringify({ input });
    init.headers = { "content-type": "application/json" };
  }
  await request(`/projects/${projectId}/apps/${appId}/actions/${actionId}`, init);
}
