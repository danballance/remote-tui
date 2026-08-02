import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const AGENT_URL = "http://192.168.86.75:43820";
const VIEW: DeckView = "lazygit";
const REFRESH_DELAY_MS = 100;

type DeckView = "lazygit";
type Action = "open" | "up" | "down";

interface Snapshot {
  running: boolean;
  lines: string[];
}

const actionFeedback: Record<Action, string> = {
  open: "LazyGit opened",
  up: "Moved up",
  down: "Moved down",
};

async function request(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`${AGENT_URL}${path}`, init);
  if (!response.ok) {
    throw new Error(`Agent request failed with status ${response.status}.`);
  }
  return response;
}

async function getSnapshot(view: DeckView): Promise<Snapshot> {
  const response = await request(`/views/${view}/snapshot`);
  return (await response.json()) as Snapshot;
}

async function runRemoteAction(view: DeckView, action: Action): Promise<void> {
  await request(`/views/${view}/actions/${action}`, { method: "POST" });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}

interface DeckButtonProps {
  label: string;
  accessibilityHint: string;
  busy: boolean;
  disabled: boolean;
  onPress(): void;
}

function DeckButton({ label, accessibilityHint, busy, disabled, onPress }: DeckButtonProps) {
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
      {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.buttonText}>{label}</Text>}
    </Pressable>
  );
}

export default function Index() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [pendingAction, setPendingAction] = useState<Action | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSnapshot(VIEW).then(setSnapshot).catch((loadError: unknown) => {
      setError(messageFrom(loadError));
    });
  }, []);

  async function runAction(action: Action): Promise<void> {
    if (pendingAction !== null) {
      return;
    }

    setPendingAction(action);
    setFeedback(null);
    setError(null);

    try {
      await runRemoteAction(VIEW, action);
      await delay(REFRESH_DELAY_MS);
      setSnapshot(await getSnapshot(VIEW));
      setFeedback(actionFeedback[action]);
    } catch (actionError) {
      setError(messageFrom(actionError));
    } finally {
      setPendingAction(null);
    }
  }

  const controlsDisabled = pendingAction !== null;
  const navigationDisabled = controlsDisabled || snapshot?.running !== true;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.page}>
        <View style={styles.terminal}>
          <ScrollView nestedScrollEnabled style={styles.terminalVerticalScroll}>
            <ScrollView horizontal>
              <Text selectable style={styles.terminalText}>
                {snapshot === null
                  ? error === null
                    ? "Loading…"
                    : "Snapshot unavailable."
                  : snapshot.running
                    ? snapshot.lines.join("\n")
                    : "LazyGit is not running."}
              </Text>
            </ScrollView>
          </ScrollView>
        </View>

        <ScrollView
          contentContainerStyle={styles.controlRailContent}
          showsVerticalScrollIndicator={false}
          style={styles.controlRail}
        >
          <Text accessibilityRole="header" style={styles.title}>
            LazyGit
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
            <DeckButton
              accessibilityHint="Opens or restarts the dedicated LazyGit session"
              busy={pendingAction === "open"}
              disabled={controlsDisabled}
              label="Open / Restart"
              onPress={() => void runAction("open")}
            />
            <View style={styles.navigationRow}>
              <View style={styles.navigationButton}>
                <DeckButton
                  accessibilityHint="Moves the LazyGit selection up by one row"
                  busy={pendingAction === "up"}
                  disabled={navigationDisabled}
                  label="Up"
                  onPress={() => void runAction("up")}
                />
              </View>
              <View style={styles.navigationButton}>
                <DeckButton
                  accessibilityHint="Moves the LazyGit selection down by one row"
                  busy={pendingAction === "down"}
                  disabled={navigationDisabled}
                  label="Down"
                  onPress={() => void runAction("down")}
                />
              </View>
            </View>
          </View>
        </ScrollView>
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
    gap: 16,
    padding: 16,
  },
  title: {
    color: "#f8fafc",
    fontSize: 30,
    fontWeight: "800",
  },
  terminal: {
    flex: 1,
    minWidth: 0,
    borderRadius: 12,
    backgroundColor: "#020617",
    overflow: "hidden",
    padding: 14,
  },
  terminalVerticalScroll: {
    flex: 1,
  },
  terminalText: {
    minWidth: 620,
    color: "#dbeafe",
    fontFamily: "monospace",
    fontSize: 12,
    lineHeight: 17,
  },
  controlRail: {
    width: "28%",
    minWidth: 200,
    maxWidth: 280,
  },
  controlRailContent: {
    flexGrow: 1,
    gap: 16,
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
    gap: 12,
    marginTop: "auto",
  },
  navigationRow: {
    flexDirection: "row",
    gap: 12,
  },
  navigationButton: {
    flex: 1,
  },
  button: {
    minHeight: 72,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: "#0369a1",
    paddingHorizontal: 20,
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
    fontSize: 20,
    fontWeight: "800",
  },
});
