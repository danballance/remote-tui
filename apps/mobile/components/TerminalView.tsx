"use dom";

import "@xterm/xterm/css/xterm.css";

import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";

export interface TerminalFrame {
  running: boolean;
  columns: number;
  rows: number;
  ansi: string;
  cursorX: number;
  cursorY: number;
  cursorVisible: boolean;
}

interface TerminalViewProps {
  frame: TerminalFrame;
  dom?: import("expo/dom").DOMProps;
}

const DEFAULT_COLUMNS = 120;
const DEFAULT_ROWS = 35;

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

    return () => {
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
