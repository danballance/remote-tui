/** Trusted settings bundled directly with the mobile application. */

import { agentConnection, terminalDimensions } from "./shared.js";
import type { MobileConfig } from "./types.js";

export type { MobileConfig, MobileTerminalConfig } from "./types.js";

export const mobileConfig = {
  agentUrl: `http://${agentConnection.host}:${agentConnection.port}`,
  refreshDelayMs: 100,
  terminal: {
    ...terminalDimensions,
    fontSize: 9,
    maxFittedFontSize: 48,
  },
} as const satisfies MobileConfig;
