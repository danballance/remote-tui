/** Remote controls for Yazi. */

import type { ApplicationModuleDefinition } from "../applications.js";

const yazi = {
  order: 20,
  id: "yazi",
  title: "Yazi",
  command: "exec yazi",
  actions: [
    { id: "up", label: "Up", sendKeysArgs: ["Up"] },
    { id: "down", label: "Down", sendKeysArgs: ["Down"] },
  ],
} as const satisfies ApplicationModuleDefinition;

export default yazi;
