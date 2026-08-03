/** Pino/Fastify log levels accepted by the desktop agent. */
export type AgentLogLevel =
  | "trace"
  | "debug"
  | "info"
  | "warn"
  | "error"
  | "fatal"
  | "silent";

/** Agent startup and persistence settings. */
export interface AgentConfig {
  readonly host: string;
  readonly port: number;
  readonly logLevel: AgentLogLevel;
  readonly projectStorePath: string;
}

/** Initial dimensions for new tmux sessions and stopped terminal frames. */
export interface TmuxTerminalConfig {
  readonly columns: number;
  readonly rows: number;
}

/** Tmux naming and terminal settings owned by the agent. */
export interface TmuxConfig {
  readonly sessionPrefix: string;
  readonly terminal: TmuxTerminalConfig;
}

/** Mobile terminal sizing settings. */
export interface MobileTerminalConfig extends TmuxTerminalConfig {
  readonly fontSize: number;
  readonly maxFittedFontSize: number;
}

/** Complete settings safe to bundle with the mobile application. */
export interface MobileConfig {
  readonly agentUrl: string;
  readonly refreshDelayMs: number;
  readonly terminal: MobileTerminalConfig;
}

/** Complete settings used by the desktop agent. */
export interface RemoteDeckConfig {
  readonly agent: AgentConfig;
  readonly tmux: TmuxConfig;
}
