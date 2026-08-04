# Application definitions

Each top-level `.ts` file in this directory defines one trusted application and
all of its actions. The agent discovers these files once at startup; no central
registry needs to be updated.

```ts
import type { ApplicationModuleDefinition } from "../applications.js";

export default {
  order: 40,
  id: "example",
  title: "Example",
  command: "exec example",
  actions: [{ id: "up", label: "Up", sendKeysArgs: ["Up"] }],
} as const satisfies ApplicationModuleDefinition;
```

Lower `order` values appear first. Apps with the same order are sorted by ID.
IDs must start with a lowercase letter or number and may contain lowercase
letters, numbers, hyphens, and underscores. Restart the production agent after
adding or changing a definition; development watch mode restarts automatically.
