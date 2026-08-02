/** Application launcher route for one persisted project. */

import { router, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  getProject,
  launchApp,
  listApps,
  type Project,
  type RemoteApp,
} from "../../lib/agent";

/** Converts caught values into text that can be shown alongside the launcher. */
function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}

/** Loads the selected project and renders the server-owned application catalog. */
export default function ProjectLauncher() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [apps, setApps] = useState<RemoteApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingAppId, setPendingAppId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getProject(projectId), listApps()])
      .then(([loadedProject, loadedApps]) => {
        console.info("[launcher] project and app catalog loaded", {
          projectId,
          appCount: loadedApps.length,
        });
        setProject(loadedProject);
        setApps(loadedApps);
      })
      .catch((loadError: unknown) => {
        console.error("[launcher] failed to load project or app catalog", {
          projectId,
          error: loadError,
        });
        setError(messageFrom(loadError));
      })
      .finally(() => setLoading(false));
  }, [projectId]);

  /** Ensures the app window exists before opening its self-loading terminal route. */
  async function openApp(application: RemoteApp): Promise<void> {
    if (pendingAppId !== null) {
      return;
    }

    setPendingAppId(application.id);
    setError(null);
    console.info("[launcher] launching or reconnecting app", {
      projectId,
      appId: application.id,
    });

    try {
      await launchApp(projectId, application.id);
      console.info("[launcher] app ready; opening terminal", {
        projectId,
        appId: application.id,
      });
      router.push({
        pathname: "/projects/[projectId]/apps/[appId]",
        params: { appId: application.id, projectId },
      });
    } catch (launchError) {
      console.error("[launcher] failed to launch or reconnect app", {
        projectId,
        appId: application.id,
        error: launchError,
      });
      setError(messageFrom(launchError));
    } finally {
      setPendingAppId(null);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.page}>
        <View style={styles.header}>
          <Pressable
            accessibilityHint="Returns to the project list"
            accessibilityLabel="Back to projects"
            accessibilityRole="button"
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backButton, pressed && styles.buttonPressed]}
          >
            <Text style={styles.backButtonText}>Projects</Text>
          </Pressable>
          <View style={styles.headingText}>
            <Text accessibilityRole="header" style={styles.title}>
              {project?.name ?? "Project"}
            </Text>
            <Text numberOfLines={1} style={styles.directory}>
              {project?.directory ?? "Loading project…"}
            </Text>
          </View>
        </View>

        {loading ? (
          <ActivityIndicator color="#38bdf8" size="large" style={styles.loader} />
        ) : (
          <View style={styles.launcher}>
            <Text style={styles.prompt}>Choose an app</Text>
            <View style={styles.appGrid}>
              {apps.map((application) => {
                const pending = pendingAppId === application.id;
                return (
                  <Pressable
                    accessibilityHint={`Launches or reconnects to ${application.title}`}
                    accessibilityLabel={application.title}
                    accessibilityRole="button"
                    accessibilityState={{ busy: pending, disabled: pendingAppId !== null }}
                    disabled={pendingAppId !== null}
                    key={application.id}
                    onPress={() => void openApp(application)}
                    style={({ pressed }) => [
                      styles.appCard,
                      pendingAppId !== null && styles.buttonDisabled,
                      pressed && pendingAppId === null && styles.appCardPressed,
                    ]}
                  >
                    {pending ? (
                      <ActivityIndicator color="#ffffff" size="large" />
                    ) : (
                      <>
                        <Text style={styles.appTitle}>{application.title}</Text>
                        <Text style={styles.appHint}>Launch or reconnect</Text>
                      </>
                    )}
                  </Pressable>
                );
              })}
            </View>
            {error === null ? null : (
              <Text accessibilityLiveRegion="assertive" style={styles.error}>
                {error}
              </Text>
            )}
          </View>
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
    gap: 28,
    padding: 20,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  backButton: {
    minHeight: 48,
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "#1e3a52",
    paddingHorizontal: 16,
  },
  backButtonText: {
    color: "#e0f2fe",
    fontSize: 16,
    fontWeight: "700",
  },
  buttonPressed: {
    backgroundColor: "#28506d",
  },
  headingText: {
    flex: 1,
    gap: 3,
  },
  title: {
    color: "#f8fafc",
    fontSize: 30,
    fontWeight: "800",
  },
  directory: {
    color: "#94a3b8",
    fontFamily: "monospace",
    fontSize: 13,
  },
  loader: {
    flex: 1,
  },
  launcher: {
    flex: 1,
    gap: 18,
  },
  prompt: {
    color: "#cbd5e1",
    fontSize: 20,
    fontWeight: "600",
  },
  appGrid: {
    flexDirection: "row",
    gap: 16,
  },
  appCard: {
    flex: 1,
    minHeight: 160,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderColor: "#1e5b7d",
    borderWidth: 1,
    borderRadius: 16,
    backgroundColor: "#0f2a3f",
    padding: 20,
  },
  appCardPressed: {
    backgroundColor: "#164767",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  appTitle: {
    color: "#f8fafc",
    fontSize: 26,
    fontWeight: "800",
  },
  appHint: {
    color: "#7dd3fc",
    fontSize: 14,
  },
  error: {
    color: "#fecaca",
    fontSize: 15,
    lineHeight: 21,
  },
});
