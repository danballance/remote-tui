/** Interactive package.json script discovery and execution. */

import type { ApplicationModuleDefinition } from "../applications.js";

const packageScripts = {
  order: 40,
  id: "package-scripts",
  title: "Package Scripts",
  command: "exec nr",
  actions: [
    { id: "run", label: "Run", sendKeysArgs: ["Enter"] },
    { id: "cancel", label: "Cancel", sendKeysArgs: ["Escape"] },
    { id: "stop", label: "Stop", sendKeysArgs: ["C-c"] },
    { id: "up", label: "Up", sendKeysArgs: ["Up"] },
    { id: "down", label: "Down", sendKeysArgs: ["Down"] },
  ],
} as const satisfies ApplicationModuleDefinition;

export default packageScripts;
