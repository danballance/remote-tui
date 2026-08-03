/** A user-visible workspace registered with the desktop agent. */
export interface Project {
  id: string;
  name: string;
  directory: string;
}

/** Request payload used to register an existing directory. */
export interface CreateProjectRequest {
  name: string;
  directory: string;
}

/** Client-safe instructions for collecting one line of action input. */
export interface ApplicationActionTextInput {
  type: "text";
  label: string;
  placeholder?: string;
  required: boolean;
  maxLength: number;
}

/** Client-safe action metadata returned by the application catalog. */
export interface PublicApplicationAction {
  id: string;
  label: string;
  input?: ApplicationActionTextInput;
}

/** Public application metadata; commands and tmux keys remain agent-owned. */
export interface PublicApplication {
  id: string;
  title: string;
  actions: readonly PublicApplicationAction[];
}

/** Optional request body for actions that accept text. */
export interface ApplicationActionRequest {
  input: string;
}

/** Complete terminal grid and cursor state returned to the mobile renderer. */
export interface TerminalFrame {
  running: boolean;
  columns: number;
  rows: number;
  ansi: string;
  cursorX: number;
  cursorY: number;
  cursorVisible: boolean;
}
