/** Remote controls for Pi. */

import type { ApplicationModuleDefinition } from "../applications.js";

const pi = {
  order: 30,
  id: "pi",
  title: "Pi",
  command: "exec pi",
  actions: [
    { id: "up", label: "Up", sendKeysArgs: ["Up"] },
    { id: "down", label: "Down", sendKeysArgs: ["Down"] },
  ],
} as const satisfies ApplicationModuleDefinition;

export default pi;
