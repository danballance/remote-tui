/** Trusted, source-controlled settings for the desktop agent. */

import { fileURLToPath } from "node:url";

import { agentConnection, terminalDimensions } from "./shared.js";
import type { RemoteDeckConfig } from "./types.js";

export type {
  AgentConfig,
  AgentLogLevel,
  MobileConfig,
  MobileTerminalConfig,
  RemoteDeckConfig,
  TmuxConfig,
  TmuxTerminalConfig,
} from "./types.js";

export const remoteDeckConfig = {
  agent: {
    ...agentConnection,
    logLevel: "info",
    projectStorePath: fileURLToPath(
      new URL("../../../apps/agent/.data/projects.json", import.meta.url),
    ),
  },
  tmux: {
    sessionPrefix: "remote-deck-",
    terminal: terminalDimensions,
  },
} as const satisfies RemoteDeckConfig;
