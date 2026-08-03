/** Read-only terminal and allow-listed controls for one project application. */

import { router, Stack, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import ActionInputModal, {
  type RemoteTextInputAction,
} from "../../../../components/ActionInputModal";
import TerminalView, { type TerminalFrame } from "../../../../components/TerminalView";
import { getMobileConfig } from "../../../../lib/config";
import {
  getApp,
  getSnapshot,
  runRemoteAction,
  type RemoteApp,
  type RemoteAppAction,
} from "../../../../lib/agent";

/** Waits briefly for a TUI to redraw before requesting the next snapshot. */
function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Converts caught values into text suitable for the terminal control rail. */
function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}

/** Props shared by the large accessible terminal action buttons. */
interface DeckButtonProps {
  label: string;
  accessibilityHint: string;
  busy: boolean;
  disabled: boolean;
  onPress(): void;
}

/** Renders one busy/disabled-aware action control. */
function DeckButton({
  label,
  accessibilityHint,
  busy,
  disabled,
  onPress,
}: DeckButtonProps) {
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator color="#ffffff" />
      ) : (
        <Text style={styles.buttonText}>{label}</Text>
      )}
    </Pressable>
  );
}

/** Displays a captured terminal frame and the selected app's allow-listed actions. */
export default function AppTerminal() {
  const mobileConfig = getMobileConfig();
  const { appId, projectId } = useLocalSearchParams<{
    appId: string;
    projectId: string;
  }>();
  const [application, setApplication] = useState<RemoteApp | null>(null);
  const [snapshot, setSnapshot] = useState<TerminalFrame | null>(null);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [inputAction, setInputAction] = useState<RemoteTextInputAction | null>(null);
  const [inputDraft, setInputDraft] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [terminalExpanded, setTerminalExpanded] = useState(false);
  const safeAreaInsets = useSafeAreaInsets();

  // Fetch canonical app metadata here so direct navigation never relies on route labels.
  useEffect(() => {
    Promise.all([getApp(appId), getSnapshot(projectId, appId)])
      .then(([loadedApplication, loadedSnapshot]) => {
        console.info("[terminal] app details and initial snapshot loaded", {
          projectId,
          appId,
          actionCount: loadedApplication.actions.length,
          running: loadedSnapshot.running,
          columns: loadedSnapshot.columns,
          rows: loadedSnapshot.rows,
        });
        setApplication(loadedApplication);
        setSnapshot(loadedSnapshot);
      })
      .catch((loadError: unknown) => {
        console.error("[terminal] failed to load app details or initial snapshot", {
          projectId,
          appId,
          error: loadError,
        });
        setError(messageFrom(loadError));
      });
  }, [appId, projectId]);

  /** Lets Android back restore the split layout before navigating away. */
  useEffect(() => {
    if (!terminalExpanded) {
      return;
    }

    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      console.info("[terminal] Android back collapsed the expanded terminal", {
        projectId,
        appId,
      });
      setTerminalExpanded(false);
      return true;
    });
    return () => subscription.remove();
  }, [appId, projectId, terminalExpanded]);

  /** Receives expand/collapse requests from the xterm DOM component. */
  const handleTerminalExpandedChange = useCallback(
    async (expanded: boolean): Promise<void> => {
      console.info("[terminal] terminal display mode changed", {
        projectId,
        appId,
        expanded,
      });
      setTerminalExpanded(expanded);
    },
    [appId, projectId],
  );

  /** Sends an action and refreshes the terminal even when execution fails partway. */
  async function runAction(action: RemoteAppAction, input?: string): Promise<void> {
    if (pendingActionId !== null) {
      return;
    }

    setPendingActionId(action.id);
    setFeedback(null);
    setError(null);
    console.info("[terminal] sending app action", {
      projectId,
      appId,
      actionId: action.id,
      hasInput: input !== undefined,
    });

    let actionError: unknown;
    try {
      await runRemoteAction(projectId, appId, action.id, input);
    } catch (caughtActionError) {
      actionError = caughtActionError;
      console.error("[terminal] app action failed", {
        projectId,
        appId,
        actionId: action.id,
        error: caughtActionError,
      });
    }

    try {
      await delay(mobileConfig.refreshDelayMs);
      const refreshedSnapshot = await getSnapshot(projectId, appId);
      setSnapshot(refreshedSnapshot);
      if (actionError === undefined) {
        setFeedback(`${action.label} sent.`);
        console.info("[terminal] app action completed and snapshot refreshed", {
          projectId,
          appId,
          actionId: action.id,
          running: refreshedSnapshot.running,
        });
      } else {
        setError(messageFrom(actionError));
      }
    } catch (refreshError) {
      console.error("[terminal] failed to refresh after app action", {
        projectId,
        appId,
        actionId: action.id,
        error: refreshError,
      });
      setError(messageFrom(actionError ?? refreshError));
    } finally {
      setPendingActionId(null);
    }
  }

  /** Opens a prompt for input actions and immediately runs all other actions. */
  function handleActionPress(action: RemoteAppAction): void {
    if (action.input === undefined) {
      void runAction(action);
      return;
    }

    setFeedback(null);
    setError(null);
    setInputDraft("");
    setInputAction({ ...action, input: action.input });
  }

  /** Closes the prompt without sending any keys or text. */
  function cancelActionInput(): void {
    setInputAction(null);
    setInputDraft("");
  }

  /** Clears the draft before sending the complete configured input action. */
  function submitActionInput(): void {
    if (inputAction === null || pendingActionId !== null) {
      return;
    }
    const input = inputDraft.trim();
    if (inputAction.input.required && input === "") {
      return;
    }

    const action = inputAction;
    setInputAction(null);
    setInputDraft("");
    void runAction(action, input);
  }

  // Keep every configured action inert until the pane is known to be running and idle.
  const controlsDisabled =
    pendingActionId !== null || inputAction !== null || snapshot?.running !== true;
  // The route ID remains a useful heading while canonical metadata is still loading.
  const appTitle = application?.title ?? appId;

  return (
    <SafeAreaView
      edges={terminalExpanded ? [] : ["top", "right", "bottom", "left"]}
      style={styles.safeArea}
    >
      <Stack.Screen
        options={{
          navigationBarHidden: terminalExpanded,
          statusBarHidden: terminalExpanded,
        }}
      />
      <StatusBar hidden={terminalExpanded} style="light" />
      <ActionInputModal
        action={inputAction}
        onCancel={cancelActionInput}
        onChange={setInputDraft}
        onSubmit={submitActionInput}
        value={inputDraft}
      />
      <View style={[styles.page, terminalExpanded && styles.pageExpanded]}>
        <View style={[styles.terminal, terminalExpanded && styles.terminalExpanded]}>
          {snapshot === null ? (
            <Text style={styles.terminalMessage}>
              {error === null ? "Loading…" : "Snapshot unavailable."}
            </Text>
          ) : snapshot.running ? (
            <TerminalView
              config={mobileConfig.terminal}
              dom={{ scrollEnabled: true, style: styles.terminalWebView }}
              expanded={terminalExpanded}
              frame={snapshot}
              onExpandedChange={handleTerminalExpandedChange}
              safeAreaInsets={safeAreaInsets}
            />
          ) : (
            <Text style={styles.terminalMessage}>{appTitle} is not running.</Text>
          )}
        </View>

        {terminalExpanded ? null : (
          <ScrollView
            contentContainerStyle={styles.controlRailContent}
            showsVerticalScrollIndicator={false}
            style={styles.controlRail}
          >
            <Pressable
              accessibilityHint="Returns to this project's app launcher"
              accessibilityLabel="Back to apps"
              accessibilityRole="button"
              onPress={() => router.back()}
              style={({ pressed }) => [
                styles.backButton,
                pressed && styles.backButtonPressed,
              ]}
            >
              <Text style={styles.backButtonText}>Apps</Text>
            </Pressable>
            <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
              {appTitle}
            </Text>

            <View style={styles.messages}>
              {feedback === null ? null : (
                <Text accessibilityLiveRegion="polite" style={styles.feedback}>
                  {feedback}
                </Text>
              )}
              {error === null ? null : (
                <Text accessibilityLiveRegion="assertive" style={styles.error}>
                  {error}
                </Text>
              )}
            </View>

            <View style={styles.controls}>
              {application !== null && application.actions.length === 0 ? (
                <Text style={styles.emptyControls}>No actions available.</Text>
              ) : (
                <View style={styles.actionGrid}>
                  {/* Preserve server order while the wrapping grid handles any action count. */}
                  {application?.actions.map((action) => (
                    <View key={action.id} style={styles.actionButton}>
                      <DeckButton
                        accessibilityHint={
                          action.input === undefined
                            ? `Sends ${action.label} to ${appTitle}`
                            : `Opens text input for ${action.label}`
                        }
                        busy={pendingActionId === action.id}
                        disabled={controlsDisabled}
                        label={action.label}
                        onPress={() => handleActionPress(action)}
                      />
                    </View>
                  ))}
                </View>
              )}
            </View>
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#07111f",
  },
  page: {
    flex: 1,
    flexDirection: "row",
    gap: 8,
    padding: 4,
  },
  pageExpanded: {
    gap: 0,
    padding: 0,
  },
  terminal: {
    flex: 1,
    minWidth: 0,
    borderRadius: 12,
    backgroundColor: "#020617",
    overflow: "hidden",
    padding: 4,
  },
  terminalExpanded: {
    borderRadius: 0,
    padding: 0,
  },
  terminalWebView: {
    flex: 1,
    backgroundColor: "#020617",
  },
  terminalMessage: {
    color: "#dbeafe",
    fontFamily: "monospace",
    fontSize: 12,
    lineHeight: 17,
  },
  controlRail: {
    width: "18%",
    minWidth: 125,
    maxWidth: 200,
  },
  controlRailContent: {
    flexGrow: 1,
    gap: 8,
  },
  backButton: {
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "#1e3a52",
  },
  backButtonPressed: {
    backgroundColor: "#28506d",
  },
  backButtonText: {
    color: "#e0f2fe",
    fontSize: 15,
    fontWeight: "700",
  },
  title: {
    color: "#f8fafc",
    fontSize: 20,
    fontWeight: "800",
  },
  messages: {
    gap: 8,
  },
  feedback: {
    color: "#86efac",
    fontSize: 15,
    fontWeight: "600",
  },
  error: {
    color: "#fecaca",
    fontSize: 15,
    lineHeight: 21,
  },
  controls: {
    gap: 8,
    marginTop: "auto",
  },
  actionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  actionButton: {
    flexBasis: "45%",
    flexGrow: 1,
  },
  emptyControls: {
    color: "#94a3b8",
    fontSize: 14,
    lineHeight: 20,
  },
  button: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "#0369a1",
    paddingHorizontal: 4,
  },
  buttonDisabled: {
    backgroundColor: "#334155",
    opacity: 0.65,
  },
  buttonPressed: {
    backgroundColor: "#0284c7",
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "800",
  },
});
