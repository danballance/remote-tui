/** Trusted application catalog and its source-controlled implementation. */

import type {
  ApplicationActionTextInput,
  PublicApplication,
} from "@remote-deck/contracts";

/** An agent-owned action whose tmux behavior is never sent to clients. */
export interface AppActionDefinition {
  readonly id: string;
  readonly label: string;
  readonly sendKeysArgs: readonly string[];
  readonly input?: ApplicationActionTextInput;
  readonly sendKeysAfterInputArgs?: readonly string[];
}

/** An agent-owned application that may be launched by its public ID. */
export interface AppDefinition {
  readonly id: string;
  readonly title: string;
  readonly command: string;
  readonly actions: readonly AppActionDefinition[];
}

/** Read-only application and app-scoped action lookup boundary. */
export interface ApplicationCatalog {
  listApplications(): readonly AppDefinition[];
  getApplication(appId: string): AppDefinition | undefined;
  getAction(appId: string, actionId: string): AppActionDefinition | undefined;
}

/** In-memory catalog for trusted definitions declared in TypeScript. */
export class StaticApplicationCatalog implements ApplicationCatalog {
  constructor(private readonly applications: readonly AppDefinition[]) {}

  listApplications(): readonly AppDefinition[] {
    return this.applications;
  }

  getApplication(appId: string): AppDefinition | undefined {
    return this.applications.find((application) => application.id === appId);
  }

  getAction(appId: string, actionId: string): AppActionDefinition | undefined {
    return this.getApplication(appId)?.actions.find(
      (action) => action.id === actionId,
    );
  }
}

/** Removes private commands and tmux keys from one catalog entry. */
export function publicApplication(application: AppDefinition): PublicApplication {
  return {
    id: application.id,
    title: application.title,
    actions: application.actions.map(({ id, label, input }) => ({
      id,
      label,
      ...(input === undefined ? {} : { input: { ...input } }),
    })),
  };
}

/** Default application ordering and behavior used by the local agent. */
export const defaultApplications = [
  {
    id: "lazygit",
    title: "LazyGit",
    command: "exec lazygit",
    actions: [
      { id: "push", label: "Push", sendKeysArgs: ["P"] },
      { id: "pull", label: "Pull", sendKeysArgs: ["p"] },
      { id: "stage", label: "Stage", sendKeysArgs: ["Space"] },
      {
        id: "commit",
        label: "Commit",
        sendKeysArgs: ["c"],
        input: {
          type: "text",
          label: "Commit message",
          placeholder: "Summary of changes",
          required: true,
          maxLength: 256,
        },
        sendKeysAfterInputArgs: ["Enter"],
      },
      { id: "up", label: "Up", sendKeysArgs: ["Up"] },
      { id: "down", label: "Down", sendKeysArgs: ["Down"] },
    ],
  },
  {
    id: "yazi",
    title: "Yazi",
    command: "exec yazi",
    actions: [
      { id: "up", label: "Up", sendKeysArgs: ["Up"] },
      { id: "down", label: "Down", sendKeysArgs: ["Down"] },
    ],
  },
  {
    id: "pi",
    title: "Pi",
    command: "exec pi",
    actions: [
      { id: "up", label: "Up", sendKeysArgs: ["Up"] },
      { id: "down", label: "Down", sendKeysArgs: ["Down"] },
    ],
  },
] as const satisfies readonly AppDefinition[];

/** Creates the production catalog behind its interface. */
export function createApplicationCatalog(): ApplicationCatalog {
  return new StaticApplicationCatalog(defaultApplications);
}
