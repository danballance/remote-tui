/** Protocols supported by the current HTTP agent and mobile client. */
export type AgentProtocol = "http" | "https";

/** Pino/Fastify log levels accepted by the desktop agent. */
export type AgentLogLevel =
  | "trace"
  | "debug"
  | "info"
  | "warn"
  | "error"
  | "fatal"
  | "silent";

/** Agent startup, persistence, and catalog settings. */
export interface AgentConfig {
  readonly protocol: AgentProtocol;
  readonly host: string;
  readonly port: number;
  readonly logLevel: AgentLogLevel;
  readonly applicationCatalogPath: string;
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

/** Mobile terminal sizing values embedded by Expo. */
export interface MobileTerminalConfig extends TmuxTerminalConfig {
  readonly fontSize: number;
  readonly maxFittedFontSize: number;
}

/** Complete mobile-safe configuration embedded in the Expo manifest. */
export interface MobileConfig {
  readonly agentUrl: string;
  readonly refreshDelayMs: number;
  readonly terminal: MobileTerminalConfig;
}

/** Mobile-only settings from the private root configuration. */
export interface MobileSourceConfig {
  readonly refreshDelayMs: number;
  readonly terminal: {
    readonly fontSize: number;
    readonly maxFittedFontSize: number;
  };
}

/** Complete validated configuration used to compose Remote Deck. */
export interface RemoteDeckConfig {
  readonly agent: AgentConfig;
  readonly tmux: TmuxConfig;
  readonly mobile: MobileSourceConfig;
}
