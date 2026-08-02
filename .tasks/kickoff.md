# Remote Deck: Initial Technical Design

## 1. Project goal

Build a dedicated Android application that lets the user operate selected terminal applications running on a NixOS desktop through:

* Large, accessible, nested controls.
* A read-only view of the target terminal pane.
* Predefined, allow-listed action identifiers.
* Private network access through Tailscale.
* No arbitrary remote shell execution.
* No dependence on global Wayland keyboard injection.

The first supported application will be LazyGit running in a dedicated tmux session.

The working project name used here is **Remote Deck**.

---

## 2. The smallest useful product

The first version should support this complete workflow:

1. Open Remote Deck on Android.
2. Unlock it biometrically.
3. Connect to the NixOS machine over Tailscale.
4. Open the LazyGit page.
5. See a text snapshot of LazyGit.
6. Press one of six large controls:

   * Open or restart LazyGit
   * Up
   * Down
   * Enter
   * Escape
   * Toggle stage
7. See the updated LazyGit screen and an explicit success or failure indication.

This proves all the important assumptions:

* The phone can reach the desktop securely.
* The user interface is physically comfortable.
* tmux can display enough useful information on the phone.
* Named actions reach the intended application.
* The interaction feels responsive enough.
* The architecture can be extended without exposing a shell.

### Deliberate non-goals

The first version should not include:

* A fully interactive terminal.
* Arbitrary text entry.
* SSH implemented inside React Native.
* Control of the existing desktop tmux session.
* Niri control.
* Neovim control.
* Multiple computers.
* User-defined commands in the Android app.
* Commit, push, delete, shutdown or other destructive operations.
* Graphical desktop streaming.
* Voice control.
* Context-sensitive menus.
* Background notifications.

These can all be added without invalidating the initial architecture.

---

## 3. Recommended architecture

```text
┌─────────────────────────────────────┐
│ Android: React Native application   │
│                                     │
│  ┌───────────────────────────────┐  │
│  │ Read-only terminal snapshot   │  │
│  └───────────────────────────────┘  │
│                                     │
│  ┌───────────┐  ┌───────────┐       │
│  │ Up        │  │ Down      │       │
│  ├───────────┤  ├───────────┤       │
│  │ Enter     │  │ Escape    │       │
│  ├───────────┤  ├───────────┤       │
│  │ Stage     │  │ Refresh   │       │
│  └───────────┘  └───────────┘       │
└──────────────────┬──────────────────┘
                   │
          HTTPS over Tailscale
                   │
┌──────────────────▼──────────────────┐
│ Tailscale Serve                     │
│                                     │
│ HTTPS termination                   │
│ Tailscale identity headers          │
│ Proxy to 127.0.0.1 only             │
└──────────────────┬──────────────────┘
                   │
          http://127.0.0.1:43820
                   │
┌──────────────────▼──────────────────┐
│ Remote Deck Agent                   │
│ Node.js + TypeScript + Fastify      │
│ Running as the desktop user         │
│                                     │
│  GET  /v1/catalog                   │
│  GET  /v1/views/:id                 │
│  POST /v1/actions/:id               │
│                                     │
│  Action allow-list                  │
│  Authentication                    │
│  Idempotency protection             │
│  Audit log                          │
└──────────────────┬──────────────────┘
                   │
          Direct process execution
                   │
┌──────────────────▼──────────────────┐
│ Dedicated tmux session              │
│                                     │
│ remote-deck:lazygit.0               │
│              └── lazygit            │
└─────────────────────────────────────┘
```

Tailscale Serve can expose a localhost HTTP service as an HTTPS service available only within the tailnet. It adds authenticated identity headers such as `Tailscale-User-Login`, removes caller-supplied copies of those headers to prevent spoofing, and recommends that the backend listen only on localhost.

---

## 4. Primary architectural decisions

### 4.1 Use HTTPS, not SSH, as the application protocol

Do not embed an SSH client in the first React Native version.

SSH would introduce:

* Native SSH library selection.
* Private-key provisioning and storage.
* Host-key verification.
* PTY management.
* Terminal resize handling.
* Connection lifecycle management.
* More difficult Expo development.

The app does not currently need a shell. It needs three ordinary operations:

* Retrieve the control catalogue.
* Execute an action ID.
* Retrieve the current terminal display.

React Native supports ordinary HTTP requests and WebSockets, so the protocol can later evolve from polling to streaming without replacing the transport architecture.

### 4.2 Make the interface server-driven

The desktop agent should send the Android app a description of the available pages and controls.

The app should never contain:

* `tmux send-keys`
* Pane names
* Filesystem paths
* Niri command names
* Shell commands
* Application key bindings

Instead, it sees only data such as:

```json
{
  "type": "action",
  "label": "Down",
  "actionId": "lazygit.cursor.down"
}
```

This has an important practical consequence: adding or reorganising controls normally requires changing the desktop configuration, not publishing a new Android build.

The Android application becomes a reusable renderer for:

* Pages
* Buttons
* Terminal views
* Confirmation dialogs
* Status messages

### 4.3 Use a dedicated mobile tmux session

Initially, create:

```text
remote-deck:lazygit.0
```

Do not connect it to the normal `work` session.

This avoids:

* Phone dimensions resizing the desktop TUI.
* A remote button changing the desktop’s current screen.
* Uncertainty about which project or process is running.
* Accidental interference with an active local workflow.
* Complicated grouped-session behaviour during the proof of concept.

tmux can create a detached session at an explicit width and height using `new-session -d -x ... -y ...`. Its `capture-pane` command can write the visible pane contents to standard output, and `send-keys` can direct named keys to a specific pane.

A sensible starting size is approximately:

```text
64 columns × 28 rows
```

The exact dimensions should become configuration rather than an application constant.

### 4.4 Start with terminal snapshots

The agent can obtain the current screen using:

```bash
tmux capture-pane \
  -p \
  -t remote-deck:lazygit.0
```

The Android application renders the result as monospaced text.

Refresh it:

* Immediately after an action.
* Every 500–1,000 milliseconds while the view is visible.
* Never while the application is in the background.
* On demand through a Refresh control.

This is not a complete terminal implementation. It will not initially preserve colour, cursor shape, mouse handling or every detail of terminal rendering. It is nevertheless sufficient to establish whether the core workflow is useful.

---

## 5. Proposed technology stack

### Repository

Use a TypeScript pnpm workspace:

```text
remote-deck/
├── apps/
│   ├── mobile/
│   │   ├── src/
│   │   ├── app/
│   │   └── app.config.ts
│   │
│   └── agent/
│       ├── src/
│       │   ├── server.ts
│       │   ├── authentication.ts
│       │   ├── action-registry.ts
│       │   ├── tmux.ts
│       │   └── catalog.ts
│       └── package.json
│
├── packages/
│   └── protocol/
│       ├── src/
│       │   ├── catalog.ts
│       │   ├── actions.ts
│       │   └── views.ts
│       └── package.json
│
├── nix/
│   ├── package.nix
│   └── module.nix
│
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

### Android application

Use:

* React Native with Expo.
* Expo Router.
* `expo-local-authentication`.
* `expo-haptics`.
* `expo-secure-store` if an additional application token is introduced.
* Built-in `fetch` for the initial API client.
* No state-management library until the interface warrants one.

Expo Router provides file-based native navigation. Expo supplies biometric authentication, encrypted small-value storage and haptic feedback packages suitable for this application.

Use an Expo Android development build rather than designing around Expo Go. That leaves room for a native terminal component later without changing the project model.

### Desktop agent

Use:

* Node.js and TypeScript.
* Fastify.
* JSON Schema or TypeBox for request and response validation.
* Node’s `execFile` for invoking tmux.
* A systemd user service.
* Structured JSON logs.

Fastify has first-class schema-based route validation and TypeScript type-provider support. Node’s `execFile` executes a binary directly without spawning a shell by default, unlike shell-based execution methods.

TypeScript is preferable to Rust for this iteration because:

* Types can be shared with the React Native client.
* The agent is small and local.
* Most work concerns protocol and UI iteration, not raw performance.
* The security boundary comes from the action design, process privileges and network exposure—not from the implementation language.

A Rust agent remains a reasonable later hardening exercise.

---

## 6. Protocol design

The protocol should be versioned from the beginning.

### 6.1 Get the interface catalogue

```http
GET /v1/catalog
```

Example response:

```json
{
  "protocolVersion": 1,
  "revision": "2026-08-01-1",
  "pages": [
    {
      "id": "home",
      "title": "Remote Deck",
      "controls": [
        {
          "type": "page",
          "label": "LazyGit",
          "pageId": "lazygit"
        }
      ]
    },
    {
      "id": "lazygit",
      "title": "LazyGit",
      "viewId": "lazygit",
      "controls": [
        {
          "type": "action",
          "label": "Open",
          "actionId": "lazygit.open"
        },
        {
          "type": "action",
          "label": "Up",
          "actionId": "lazygit.cursor.up"
        },
        {
          "type": "action",
          "label": "Down",
          "actionId": "lazygit.cursor.down"
        },
        {
          "type": "action",
          "label": "Enter",
          "actionId": "lazygit.enter"
        },
        {
          "type": "action",
          "label": "Escape",
          "actionId": "lazygit.escape"
        },
        {
          "type": "action",
          "label": "Toggle stage",
          "actionId": "lazygit.toggle-stage"
        }
      ]
    }
  ]
}
```

Notice that this document contains no executable commands.

### 6.2 Retrieve a terminal view

```http
GET /v1/views/lazygit
```

Example response:

```json
{
  "id": "lazygit",
  "kind": "terminal-snapshot",
  "width": 64,
  "height": 28,
  "running": true,
  "process": "lazygit",
  "lines": [
    " Files                               | Commits",
    "─────────────────────────────────────┼────────────────────",
    " M src/server.ts                     | ..."
  ],
  "capturedAt": "2026-08-01T11:42:31.419Z"
}
```

Use an array of lines rather than one large string. That makes it easier to preserve blank rows and calculate horizontal scrolling.

### 6.3 Execute an action

```http
POST /v1/actions/lazygit.cursor.down
Idempotency-Key: a1b0d050-5a42-46c7-a54c-0173d55ee460
```

Example response:

```json
{
  "ok": true,
  "actionId": "lazygit.cursor.down",
  "message": "Moved down",
  "executedAt": "2026-08-01T11:42:31.301Z"
}
```

The client then refreshes the view.

### 6.4 Idempotency is important

Many actions are not safely repeatable:

* Toggle stage twice returns to the original state.
* Enter twice may open something and then activate it.
* Escape twice may leave two different interface levels.

The Android app should generate a UUID for every intended press. The server should cache completed responses briefly using:

```text
requesting identity + idempotency key
```

If it receives the same key twice, it should return the original result without executing the action again.

The client should also disable a button while its request is pending.

---

## 7. Shared protocol types

A minimal protocol package could begin with:

```ts
export type PageControl =
  | {
      type: "page";
      label: string;
      pageId: string;
      accessibilityHint?: string;
    }
  | {
      type: "action";
      label: string;
      actionId: string;
      accessibilityHint?: string;
      tone?: "normal" | "caution" | "danger";
    };

export interface RemotePage {
  id: string;
  title: string;
  viewId?: string;
  controls: PageControl[];
}

export interface RemoteCatalog {
  protocolVersion: 1;
  revision: string;
  pages: RemotePage[];
}

export interface TerminalSnapshot {
  id: string;
  kind: "terminal-snapshot";
  width: number;
  height: number;
  running: boolean;
  process: string | null;
  lines: string[];
  capturedAt: string;
}

export interface ActionResult {
  ok: boolean;
  actionId: string;
  message: string;
  executedAt: string;
}
```

At the API boundary, these should also have runtime schemas. TypeScript types alone do not validate network input.

---

## 8. Desktop action registry

The registry should be code, not user-supplied shell strings.

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const TMUX = "/run/current-system/sw/bin/tmux";
const SESSION = "remote-deck";
const TARGET = "remote-deck:lazygit.0";
const APP_MARKER = "lazygit";

async function tmux(...args: string[]): Promise<string> {
  const result = await execFileAsync(TMUX, args, {
    timeout: 3_000,
    maxBuffer: 1_000_000,
    shell: false
  });

  return result.stdout;
}

async function sessionExists(): Promise<boolean> {
  try {
    await tmux("has-session", "-t", SESSION);
    return true;
  } catch {
    return false;
  }
}

async function ensureLazyGit(repository: string): Promise<void> {
  if (!(await sessionExists())) {
    await tmux(
      "new-session",
      "-d",
      "-x",
      "64",
      "-y",
      "28",
      "-s",
      SESSION,
      "-n",
      "lazygit",
      "-c",
      repository,
      "lazygit"
    );

    await tmux(
      "set-option",
      "-p",
      "-t",
      TARGET,
      "@remote_deck_app",
      APP_MARKER
    );
  }
}

async function requireLazyGitTarget(): Promise<void> {
  const marker = (
    await tmux(
      "show-option",
      "-p",
      "-q",
      "-v",
      "-t",
      TARGET,
      "@remote_deck_app"
    )
  ).trim();

  if (marker !== APP_MARKER) {
    throw new Error("The target pane is not managed by Remote Deck");
  }

  const processName = (
    await tmux(
      "display-message",
      "-p",
      "-t",
      TARGET,
      "#{pane_current_command}"
    )
  ).trim();

  if (processName !== "lazygit") {
    throw new Error(`Expected lazygit, found ${processName || "nothing"}`);
  }
}

async function sendLazyGitKey(key: string): Promise<void> {
  await requireLazyGitTarget();
  await tmux("send-keys", "-t", TARGET, key);
}

export const actions = {
  "lazygit.open": async (repository: string) => {
    await ensureLazyGit(repository);
  },

  "lazygit.cursor.up": async () => {
    await sendLazyGitKey("Up");
  },

  "lazygit.cursor.down": async () => {
    await sendLazyGitKey("Down");
  },

  "lazygit.enter": async () => {
    await sendLazyGitKey("Enter");
  },

  "lazygit.escape": async () => {
    await sendLazyGitKey("Escape");
  },

  "lazygit.toggle-stage": async () => {
    // Replace with the binding in the user's LazyGit configuration.
    await sendLazyGitKey("Space");
  }
} as const;
```

Using an argument array with `execFile` prevents the action ID, repository path or key name from being interpreted by a shell. Node explicitly warns against sending unsanitised input through shell-enabled child processes.

### Action naming

Prefer honest descriptions of the operation:

```text
lazygit.toggle-stage
```

rather than:

```text
lazygit.stage
```

unless the agent can guarantee that the file ends in the staged state.

A semantic action ID does not automatically make an underlying keyboard sequence deterministic. The action name should accurately reflect whether it:

* Selects a known state.
* Toggles state.
* Opens a menu.
* Sends navigation.
* Depends on the current application screen.

---

## 9. Terminal snapshot implementation

```ts
export async function captureLazyGit(): Promise<string[]> {
  await requireLazyGitTarget();

  const output = await tmux(
    "capture-pane",
    "-p",
    "-t",
    TARGET
  );

  // Do not trim individual lines: their spaces are part of the screen layout.
  return output.replace(/\n$/, "").split("\n");
}
```

Do not initially request ANSI attributes. Plain text greatly simplifies the Android renderer.

Later, colour can be introduced through:

```bash
tmux capture-pane -p -e ...
```

but the resulting escape sequences would require a proper terminal parser. tmux documents that `capture-pane -e` includes terminal attribute sequences.

---

## 10. Authentication and network boundary

### Initial authentication model

For the first version:

1. Tailscale must be running on the phone and desktop.
2. The agent listens only on:

   ```text
   127.0.0.1:43820
   ```
3. Tailscale Serve exposes that service over HTTPS.
4. The agent checks:

   ```text
   Tailscale-User-Login
   ```
5. Only the configured login is accepted.
6. The Android application uses local biometric authentication before showing controls.

Example Fastify hook:

```ts
server.addHook("onRequest", async (request, reply) => {
  const login = request.headers["tailscale-user-login"];

  if (login !== config.allowedTailscaleLogin) {
    await reply.code(403).send({
      error: "forbidden"
    });
  }
});
```

Tailscale Serve adds the authenticated login header for tailnet traffic and removes spoofed incoming identity headers before forwarding the request. This trust model depends on the agent being reachable only through the localhost proxy.

Configure Serve with:

```bash
sudo tailscale serve --bg localhost:43820
```

The `--bg` configuration persists across Tailscale and machine restarts until disabled. Do not use Tailscale Funnel, because Funnel makes a service publicly accessible.

### Additional application token

An app-specific bearer token is optional for the initial single-user system.

It becomes useful when:

* Several people belong to the tailnet.
* Several applications use the same service.
* You want to revoke Remote Deck access independently.
* You want both possession of the phone and possession of an application credential.

Such a token should be generated by the desktop, stored using SecureStore on Android, and never placed in source code. Expo describes SecureStore as encrypted local storage intended for small secrets such as tokens.

### Security invariants

These should remain true throughout the project:

* No endpoint accepts a shell command.
* No endpoint accepts a tmux target.
* No endpoint accepts an arbitrary key sequence.
* No endpoint accepts a filesystem path from the phone.
* Unknown action IDs are rejected.
* Every subprocess has a timeout.
* The agent does not run as root.
* The agent runs as the Unix user owning the dedicated tmux session.
* The backend port is bound to localhost.
* The service is never exposed using Funnel.
* Terminal contents are not written to logs.
* Actions and outcomes are logged.
* Dangerous actions require explicit confirmation and should not be added during the initial iteration.

---

## 11. React Native interface

### Screens

The first app needs only three screens:

```text
/
├── unlock
├── connection
└── page/[pageId]
```

#### Unlock

* Biometric prompt.
* Clear fallback message when biometric authentication is unavailable.
* Lock again when the app has been backgrounded for a configurable period.

#### Connection

* Server URL:

  ```text
  https://desktop-name.tailnet-name.ts.net
  ```
* Test Connection button.
* Display the authenticated user returned by `/v1/health`.
* Save the URL locally.

#### Dynamic page

* Page title.
* Connection-state indicator.
* Optional terminal snapshot.
* Two-column control grid.
* Local Back control.
* Visible action result.
* Fixed Escape and Enter positions on applicable pages.

### Accessibility rules

The interface should be designed around accessibility from its first component:

* Large rectangular targets.
* Generous separation between controls.
* Stable control positions.
* No required swipes.
* No required long presses.
* No double-tap actions.
* No meaning communicated only by colour.
* A visible busy state.
* Haptic distinction between success and failure.
* Explicit labels and hints for TalkBack.
* Fixed placement for Escape, Enter and local Back.
* Optional one-column layout for maximum target width.
* Configurable text and terminal font sizes.
* Configurable terminal-to-controls height ratio.

React Native exposes accessibility roles, labels, hints and states to assistive technologies; these should be set on every interactive control rather than relying on visible text alone.

Example control:

```tsx
<Pressable
  accessibilityRole="button"
  accessibilityLabel="Move down"
  accessibilityHint="Moves the LazyGit selection down by one row"
  accessibilityState={{
    disabled: pending,
    busy: pending
  }}
  disabled={pending}
  onPress={execute}
>
  <Text>Down</Text>
</Pressable>
```

### Feedback model

On success:

* Brief success haptic.
* Small confirmation message.
* Immediate terminal refresh.

On failure:

* Distinct error haptic.
* Persistent error message.
* Do not silently retry a non-idempotent action.
* Keep the previous terminal snapshot visible.

---

## 12. NixOS integration

The agent should eventually be packaged as a Nix derivation, but the first development version can run from the repository.

The target user service is conceptually:

```nix
{
  services.tailscale.enable = true;

  systemd.user.services.remote-deck-agent = {
    description = "Remote Deck desktop agent";

    wantedBy = [ "default.target" ];
    after = [ "network-online.target" ];

    serviceConfig = {
      ExecStart = "${remoteDeckAgent}/bin/remote-deck-agent";
      Restart = "on-failure";
      RestartSec = 2;
    };

    environment = {
      REMOTE_DECK_HOST = "127.0.0.1";
      REMOTE_DECK_PORT = "43820";
      REMOTE_DECK_REPOSITORY = "/home/dan/src/example-project";
      REMOTE_DECK_ALLOWED_LOGIN = "your-tailscale-login";
    };
  };
}
```

The important property is that this is a **user service**, so it naturally has access to the same user’s tmux server and socket.

Configuration should eventually move from environment variables to a validated file such as:

```text
~/.config/remote-deck/config.json
```

---

## 13. Initial backlog

### Milestone A: communication

* Create pnpm workspace.
* Create Expo Android application.
* Create Fastify agent.
* Implement `/v1/health`.
* Put agent behind Tailscale Serve.
* Verify requests over both Wi-Fi and mobile data.
* Reject the wrong `Tailscale-User-Login`.

### Milestone B: dedicated tmux environment

* Implement `ensureLazyGit`.
* Create the session at a fixed size.
* Set the custom pane marker.
* Check `pane_current_command`.
* Implement terminal capture.
* Return the snapshot through `/v1/views/lazygit`.

### Milestone C: action execution

* Implement the six initial actions.
* Reject unknown actions.
* Add subprocess timeouts.
* Add structured audit logging.
* Add idempotency keys.
* Disable duplicate presses while requests are pending.

### Milestone D: accessible Android UI

* Implement biometric lock.
* Render the catalogue.
* Render terminal snapshots.
* Build one-column and two-column layouts.
* Add font-size settings.
* Add haptic success and failure feedback.
* Test with TalkBack.
* Test portrait and landscape layouts.

### Milestone E: hardening

* Ensure port 43820 is unreachable from the LAN and tailnet directly.
* Confirm it is reachable only through Tailscale Serve.
* Confirm no endpoint accepts arbitrary arguments.
* Confirm terminal contents do not enter logs.
* Add a visible warning when Tailscale is disconnected.
* Add a test that every catalogue action has a registered implementation.

---

## 14. Acceptance criteria

The proof of concept is successful when all of the following are true:

1. The app can connect to the NixOS machine from outside the home network through Tailscale.
2. The agent is not publicly exposed.
3. The phone can open a dedicated LazyGit tmux session.
4. The current LazyGit screen is recognisable on the phone.
5. Each permitted button affects only the expected tmux pane.
6. An unknown action ID cannot execute anything.
7. The phone cannot provide arbitrary keys or commands.
8. Repeated network delivery of the same request does not repeat the action.
9. The interface can be operated without precise gestures.
10. The user can comfortably perform a small, real LazyGit workflow from the phone.

A practical usability test would be:

* Open LazyGit.
* Move through the file list.
* Open and close a view.
* Toggle one file’s staged state.
* Verify the final state independently on the desktop.

---

## 15. Expansion path

### Next: richer menu catalogue

Add:

* Multiple pages.
* Fixed global controls.
* Configurable ordering.
* Icons.
* Page-specific layout.
* Caution and danger presentation.
* Catalogue revision notification.

### Then: live terminal streaming

Replace snapshot polling with a WebSocket connection.

React Native supports WebSockets, and tmux has a control mode intended for programmatic clients. A later terminal implementation could combine a tmux control-mode connection with an actual VT-compatible terminal renderer.

Do not attempt to turn plain React Native `Text` into a full terminal emulator incrementally. Once cursor positioning, ANSI styling and incremental output are required, use a real terminal rendering component—potentially xterm.js inside a WebView or a suitable native Android component.

### Then: Niri controls

Add a separate Niri action adapter:

```text
niri.focus-left
niri.focus-right
niri.workspace-up
niri.workspace-down
niri.close-window
```

The agent should still invoke fixed action IDs rather than accept arbitrary `niri msg` arguments. Niri provides an IPC socket, JSON responses and an event stream, making later status-aware controls possible.

A user-session broker may be necessary if the agent does not reliably inherit `NIRI_SOCKET`.

### Later possibilities

* Connect to the normal desktop tmux workspace.
* Multiple repositories.
* Multiple machines.
* Neovim-specific pages.
* Coding-agent controls.
* Agent status and notification surfaces.
* Typed text entry.
* Voice input.
* Android quick-settings tile.
* Home-screen widgets.
* Context-sensitive pages based on foreground process.
* Sunshine or another graphical fallback.

---

## 16. Principal recommendation

The first implementation should be:

> **React Native control renderer + HTTPS action API over Tailscale Serve + dedicated tmux session + read-only `capture-pane` display.**

The most important choices are:

* Do not implement SSH in React Native yet.
* Do not implement a complete terminal yet.
* Do not control the desktop’s existing session yet.
* Do not put commands or key sequences in the Android application.
* Let the desktop publish the control hierarchy.
* Make the action registry the explicit security boundary.
* Prove one application and six actions before expanding.

This produces a genuinely usable vertical slice rather than a disposable mock-up, while leaving clear upgrade paths to live terminal streaming, Niri IPC and a much broader accessible desktop-control system.
k=u
