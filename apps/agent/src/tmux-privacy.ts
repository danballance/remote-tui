/** Builds diagnostics for tmux calls that contain private user-supplied text. */

/** Returns a useful command shape without accepting or reproducing the private value. */
export function privateInputLogCommand(target: string): readonly string[] {
  return ["tmux", "send-keys", "-t", target, "-l", "--", "[REDACTED]"];
}

/** Extracts only primitive process state that cannot contain the tmux argument vector. */
export function privateTmuxFailureStatus(error: unknown): {
  exitCode: number | undefined;
  killed: boolean | undefined;
} {
  if (typeof error !== "object" || error === null) {
    return { exitCode: undefined, killed: undefined };
  }
  return {
    exitCode:
      "code" in error && typeof error.code === "number" ? error.code : undefined,
    killed:
      "killed" in error && typeof error.killed === "boolean"
        ? error.killed
        : undefined,
  };
}

/** Replaces Node's argv-bearing child error before it can reach Fastify. */
export function privateTmuxFailureError(): Error {
  return new Error("tmux failed while sending private action input");
}
