"use dom";

/** xterm.js renderer for complete terminal frames captured by the desktop agent. */

import "@xterm/xterm/css/xterm.css";

import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";

/** Serializable terminal state needed to reproduce one captured tmux pane. */
export interface TerminalFrame {
  /** Whether the target app window currently exists. */
  running: boolean;
  /** Current pane width in terminal cells. */
  columns: number;
  /** Current pane height in terminal cells. */
  rows: number;
  /** Full pane contents including ANSI styling sequences. */
  ansi: string;
  /** Zero-based cursor column. */
  cursorX: number;
  /** Zero-based cursor row. */
  cursorY: number;
  /** Whether xterm should display the cursor. */
  cursorVisible: boolean;
}

/** Props passed through Expo's DOM component bridge. */
interface TerminalViewProps {
  frame: TerminalFrame;
  dom?: import("expo/dom").DOMProps;
}

const DEFAULT_COLUMNS = 120;
const DEFAULT_ROWS = 35;

/**
 * Owns one read-only xterm instance and replaces its full contents for each frame.
 * Input stays disabled because commands are sent through explicit mobile controls.
 */
export default function TerminalView({ frame }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);

  useEffect(() => {
    if (containerRef.current === null) {
      return;
    }

    const terminal = new Terminal({
      cols: DEFAULT_COLUMNS,
      rows: DEFAULT_ROWS,
      convertEol: true,
      cursorBlink: false,
      disableStdin: true,
      fontFamily: "monospace",
      fontSize: 9,
      scrollback: 0,
      theme: {
        background: "#020617",
        foreground: "#dbeafe",
      },
    });

    terminal.open(containerRef.current);
    terminalRef.current = terminal;
    console.info("[terminal-view] xterm renderer opened", {
      columns: DEFAULT_COLUMNS,
      rows: DEFAULT_ROWS,
    });

    return () => {
      console.info("[terminal-view] xterm renderer disposed");
      terminal.dispose();
      terminalRef.current = null;
    };
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal === null) {
      return;
    }

    const cursorPosition = `\u001b[${frame.cursorY + 1};${frame.cursorX + 1}H`;
    const cursorVisibility = frame.cursorVisible ? "\u001b[?25h" : "\u001b[?25l";

    terminal.resize(frame.columns, frame.rows);
    terminal.reset();
    terminal.write(`\u001b[2J\u001b[H${frame.ansi}${cursorPosition}${cursorVisibility}`);
    console.debug("[terminal-view] frame rendered", {
      running: frame.running,
      columns: frame.columns,
      rows: frame.rows,
      cursorX: frame.cursorX,
      cursorY: frame.cursorY,
      cursorVisible: frame.cursorVisible,
    });
  }, [frame]);

  return (
    <>
      <style>{`
        html, body, #root {
          min-height: 100%;
          margin: 0;
          background: #020617;
        }

        body {
          overflow: auto;
        }

        #terminal {
          display: inline-block;
          min-width: 100%;
          min-height: 100%;
        }
      `}</style>
      <div id="terminal" ref={containerRef} />
    </>
  );
}
