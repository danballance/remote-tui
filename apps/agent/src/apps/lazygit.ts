/** Remote controls for LazyGit. */

import type { ApplicationModuleDefinition } from "../applications.js";

const lazygit = {
  order: 10,
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
} as const satisfies ApplicationModuleDefinition;

export default lazygit;
