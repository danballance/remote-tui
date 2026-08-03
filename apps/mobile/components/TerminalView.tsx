"use dom";

/** xterm.js renderer for complete terminal frames captured by the desktop agent. */

import "@xterm/xterm/css/xterm.css";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef, type CSSProperties } from "react";

import type { MobileTerminalConfig } from "@remote-deck/config/mobile";

import { widthFittedFontSize } from "./terminalSizing";

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
  config: MobileTerminalConfig;
  expanded: boolean;
  frame: TerminalFrame;
  onExpandedChange(expanded: boolean): Promise<void>;
  safeAreaInsets: TerminalSafeAreaInsets;
  dom?: import("expo/dom").DOMProps;
}

/** Serializable native safe-area values used inside the DOM component. */
export interface TerminalSafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Owns one read-only xterm instance and replaces its full contents for each frame.
 * Input stays disabled because commands are sent through explicit mobile controls.
 */
export default function TerminalView({
  config,
  expanded,
  frame,
  onExpandedChange,
  safeAreaInsets,
}: TerminalViewProps) {
  const { columns, fontSize, maxFittedFontSize, rows } = config;
  const containerRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const expandedRef = useRef(expanded);
  const frameColumnsRef = useRef(frame.columns);
  const lastExpandedRef = useRef(expanded);
  const sizingFrameRef = useRef<number | null>(null);
  const sizingGenerationRef = useRef(0);

  /**
   * Fits only the terminal's width, leaving excess rows to the page scroller.
   * Candidate sizes are verified against xterm after its renderer has updated.
   */
  const scheduleTerminalSizing = useCallback((resetScroll: boolean): void => {
    const generation = ++sizingGenerationRef.current;
    if (sizingFrameRef.current !== null) {
      cancelAnimationFrame(sizingFrameRef.current);
    }

    const previousScrollTop = resetScroll ? 0 : (shellRef.current?.scrollTop ?? 0);
    sizingFrameRef.current = requestAnimationFrame(() => {
      const terminal = terminalRef.current;
      const fitAddon = fitAddonRef.current;
      if (terminal === null || fitAddon === null || generation !== sizingGenerationRef.current) {
        return;
      }

      if (!expandedRef.current) {
        terminal.options.fontSize = fontSize;
        shellRef.current?.scrollTo({ left: 0, top: 0 });
        return;
      }

      const initialProposal = fitAddon.proposeDimensions();
      if (initialProposal === undefined || !Number.isFinite(initialProposal.cols)) {
        terminal.options.fontSize = fontSize;
        return;
      }

      const initialCandidate = widthFittedFontSize({
        minimumFontSize: fontSize,
        measuredFontSize: terminal.options.fontSize ?? fontSize,
        frameColumns: frameColumnsRef.current,
        proposedColumns: initialProposal.cols,
      });
      let bestCandidate = fontSize;

      const finish = (fontSize: number): void => {
        terminal.options.fontSize = fontSize;
        sizingFrameRef.current = requestAnimationFrame(() => {
          if (generation !== sizingGenerationRef.current) {
            return;
          }
          shellRef.current?.scrollTo({
            left: 0,
            top: resetScroll ? 0 : previousScrollTop,
          });
          console.debug("[terminal-view] width fit applied", {
            columns: frameColumnsRef.current,
            fontSize,
          });
        });
      };

      const measureCandidate = (candidate: number): void => {
        if (generation !== sizingGenerationRef.current) {
          return;
        }
        terminal.options.fontSize = candidate;
        sizingFrameRef.current = requestAnimationFrame(() => {
          if (generation !== sizingGenerationRef.current) {
            return;
          }
          const proposal = fitAddon.proposeDimensions();
          if (proposal === undefined || !Number.isFinite(proposal.cols)) {
            finish(fontSize);
            return;
          }

          if (proposal.cols >= frameColumnsRef.current) {
            bestCandidate = candidate;
            if (candidate < maxFittedFontSize) {
              measureCandidate(candidate + 1);
            } else {
              finish(candidate);
            }
            return;
          }

          if (candidate > bestCandidate + 1) {
            measureCandidate(candidate - 1);
          } else {
            finish(bestCandidate);
          }
        });
      };

      measureCandidate(initialCandidate);
    });
  }, [fontSize, maxFittedFontSize]);

  useEffect(() => {
    if (containerRef.current === null) {
      return;
    }

    const terminal = new Terminal({
      cols: columns,
      rows,
      convertEol: true,
      cursorBlink: false,
      disableStdin: true,
      fontFamily: "monospace",
      fontSize,
      scrollback: 0,
      theme: {
        background: "#020617",
        foreground: "#dbeafe",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    terminal.open(containerRef.current);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    const resizeObserver = new ResizeObserver(() => scheduleTerminalSizing(false));
    resizeObserver.observe(containerRef.current);
    void document.fonts.ready.then(() => scheduleTerminalSizing(false));
    console.info("[terminal-view] xterm renderer opened", {
      columns,
      rows,
    });

    return () => {
      console.info("[terminal-view] xterm renderer disposed");
      resizeObserver.disconnect();
      sizingGenerationRef.current += 1;
      if (sizingFrameRef.current !== null) {
        cancelAnimationFrame(sizingFrameRef.current);
      }
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [columns, fontSize, rows, scheduleTerminalSizing]);

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

  useEffect(() => {
    const enteringFullscreen = expanded && !lastExpandedRef.current;
    expandedRef.current = expanded;
    frameColumnsRef.current = frame.columns;
    lastExpandedRef.current = expanded;
    scheduleTerminalSizing(enteringFullscreen);
  }, [
    expanded,
    frame.columns,
    safeAreaInsets.bottom,
    safeAreaInsets.left,
    safeAreaInsets.right,
    safeAreaInsets.top,
    scheduleTerminalSizing,
  ]);

  /** Routes wheel and touch gestures to the fullscreen shell before xterm consumes them. */
  useEffect(() => {
    const shell = shellRef.current;
    if (!expanded || shell === null) {
      return;
    }

    let touchStartY = 0;
    let touchStartScrollTop = 0;

    const scrollBy = (deltaY: number): boolean => {
      const previousScrollTop = shell.scrollTop;
      shell.scrollTop = Math.max(
        0,
        Math.min(shell.scrollHeight - shell.clientHeight, previousScrollTop + deltaY),
      );
      return shell.scrollTop !== previousScrollTop;
    };
    const handleWheel = (event: WheelEvent): void => {
      if (scrollBy(event.deltaY)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const handleTouchStart = (event: TouchEvent): void => {
      const touch = event.touches.item(0);
      if (event.touches.length !== 1 || touch === null) {
        return;
      }
      touchStartY = touch.clientY;
      touchStartScrollTop = shell.scrollTop;
    };
    const handleTouchMove = (event: TouchEvent): void => {
      const touch = event.touches.item(0);
      if (event.touches.length !== 1 || touch === null) {
        return;
      }
      const previousScrollTop = shell.scrollTop;
      const nextScrollTop = Math.max(
        0,
        Math.min(
          shell.scrollHeight - shell.clientHeight,
          touchStartScrollTop + touchStartY - touch.clientY,
        ),
      );
      shell.scrollTop = nextScrollTop;
      if (nextScrollTop !== previousScrollTop) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    shell.addEventListener("wheel", handleWheel, { capture: true, passive: false });
    shell.addEventListener("touchstart", handleTouchStart, {
      capture: true,
      passive: true,
    });
    shell.addEventListener("touchmove", handleTouchMove, {
      capture: true,
      passive: false,
    });
    return () => {
      shell.removeEventListener("wheel", handleWheel, { capture: true });
      shell.removeEventListener("touchstart", handleTouchStart, { capture: true });
      shell.removeEventListener("touchmove", handleTouchMove, { capture: true });
    };
  }, [expanded]);

  /** Reports DOM clicks through Expo's asynchronous native-action bridge. */
  function requestExpandedChange(nextExpanded: boolean): void {
    void onExpandedChange(nextExpanded).catch((bridgeError: unknown) => {
      console.error("[terminal-view] failed to change expanded state", {
        expanded: nextExpanded,
        error: bridgeError,
      });
    });
  }

  const safeAreaStyle = {
    "--safe-top": `${safeAreaInsets.top}px`,
    "--safe-right": `${safeAreaInsets.right}px`,
    "--safe-bottom": `${safeAreaInsets.bottom}px`,
    "--safe-left": `${safeAreaInsets.left}px`,
  } as CSSProperties;

  return (
    <>
      <style>{`
        html, body, #root {
          height: 100%;
          margin: 0;
          background: #020617;
        }

        body {
          overflow: hidden;
          overscroll-behavior: contain;
        }

        #terminal-shell {
          position: relative;
          box-sizing: border-box;
          width: 100%;
          height: 100%;
          min-width: 100%;
          min-height: 100%;
          overflow: hidden;
          background: #020617;
        }

        #terminal-shell.expanded {
          overflow-x: hidden;
          overflow-y: auto;
          overscroll-behavior: contain;
        }

        #terminal-shell.expandable {
          cursor: zoom-in;
        }

        #terminal {
          box-sizing: border-box;
          width: 100vw;
          height: 100%;
        }

        #terminal .xterm {
          box-sizing: border-box;
        }

        #terminal-shell.expanded #terminal .xterm {
          padding-top: var(--safe-top);
          padding-right: calc(var(--safe-right) + 64px);
          padding-bottom: var(--safe-bottom);
          padding-left: var(--safe-left);
        }

        #exit-fullscreen {
          position: fixed;
          z-index: 2;
          top: calc(var(--safe-top) + 8px);
          right: calc(var(--safe-right) + 8px);
          width: 48px;
          height: 48px;
          display: grid;
          place-items: center;
          border: 1px solid #475569;
          border-radius: 12px;
          background: rgba(15, 42, 63, 0.94);
          color: #f8fafc;
          cursor: pointer;
          touch-action: manipulation;
        }

        #exit-fullscreen:active {
          background: #1e5b7d;
        }

        #exit-fullscreen:focus-visible {
          outline: 3px solid #38bdf8;
          outline-offset: 2px;
        }
      `}</style>
      <div
        aria-label={expanded ? undefined : "Expand terminal to full screen"}
        className={expanded ? "expanded" : "expandable"}
        id="terminal-shell"
        onClick={() => {
          if (!expanded) {
            requestExpandedChange(true);
          }
        }}
        onKeyDown={(event) => {
          if (!expanded && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            requestExpandedChange(true);
          }
        }}
        role={expanded ? undefined : "button"}
        ref={shellRef}
        style={safeAreaStyle}
        tabIndex={expanded ? undefined : 0}
      >
        <div id="terminal" ref={containerRef} />
        {expanded ? (
          <button
            aria-label="Exit full screen"
            id="exit-fullscreen"
            onClick={(event) => {
              event.stopPropagation();
              requestExpandedChange(false);
            }}
            title="Exit full screen"
            type="button"
          >
            <svg aria-hidden="true" height="28" viewBox="0 0 24 24" width="28">
              <path
                d="M5 16h3v3h2v-5H5v2Zm3-8H5v2h5V5H8v3Zm6 11h2v-3h3v-2h-5v5Zm2-11V5h-2v5h5V8h-3Z"
                fill="currentColor"
              />
            </svg>
          </button>
        ) : null}
      </div>
    </>
  );
}
