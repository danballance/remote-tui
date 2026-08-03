/** Project list and creation route for the Remote Deck mobile app. */

import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { Project } from "@remote-deck/contracts";

import { useAgentClient } from "../lib/AgentClientProvider";

/** Converts caught values into concise messages suitable for the visible error area. */
function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}

/** Lists persisted projects and registers new name/directory pairs. */
export default function Index() {
  const agentClient = useAgentClient();
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [directory, setDirectory] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    agentClient
      .listProjects()
      .then(setProjects)
      .catch((loadError: unknown) => {
        console.error("[projects] failed to load project list", { error: loadError });
        setError(messageFrom(loadError));
      })
      .finally(() => setLoading(false));
  }, [agentClient]);

  /** Navigates from the project list to one project's application launcher. */
  function openProject(projectId: string): void {
    router.push({ pathname: "/projects/[projectId]", params: { projectId } });
  }

  /** Persists a completed form, updates the local list, and opens the new project. */
  async function createProject(): Promise<void> {
    if (creating || name.trim() === "" || directory.trim() === "") {
      return;
    }

    setCreating(true);
    setError(null);
    console.info("[projects] creating project", { name: name.trim() });

    try {
      const project = await agentClient.createProject(
        name.trim(),
        directory.trim(),
      );
      console.info("[projects] project created", { projectId: project.id });
      setProjects((currentProjects) => [...currentProjects, project]);
      setName("");
      setDirectory("");
      openProject(project.id);
    } catch (createError) {
      console.error("[projects] failed to create project", { error: createError });
      setError(messageFrom(createError));
    } finally {
      setCreating(false);
    }
  }

  const formComplete = name.trim() !== "" && directory.trim() !== "";

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.page}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title}>
            Projects
          </Text>
          <Text style={styles.subtitle}>
            Each project owns one persistent remote workspace.
          </Text>
        </View>

        <View style={styles.content}>
          <View style={styles.projectPanel}>
            <Text style={styles.sectionTitle}>Your projects</Text>
            {loading ? (
              <ActivityIndicator color="#38bdf8" size="large" style={styles.loader} />
            ) : (
              <ScrollView contentContainerStyle={styles.projectList}>
                {projects.length === 0 ? (
                  <Text style={styles.emptyText}>Create your first project to begin.</Text>
                ) : (
                  projects.map((project) => (
                    <Pressable
                      accessibilityHint={`Opens the app launcher for ${project.name}`}
                      accessibilityLabel={project.name}
                      accessibilityRole="button"
                      key={project.id}
                      onPress={() => openProject(project.id)}
                      style={({ pressed }) => [
                        styles.projectCard,
                        pressed && styles.cardPressed,
                      ]}
                    >
                      <Text style={styles.projectName}>{project.name}</Text>
                      <Text numberOfLines={2} style={styles.projectDirectory}>
                        {project.directory}
                      </Text>
                    </Pressable>
                  ))
                )}
              </ScrollView>
            )}
          </View>

          <View style={styles.createPanel}>
            <Text style={styles.sectionTitle}>New project</Text>
            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput
              accessibilityLabel="Project name"
              autoCapitalize="words"
              onChangeText={setName}
              placeholder="Remote Deck"
              placeholderTextColor="#64748b"
              style={styles.input}
              value={name}
            />
            <Text style={styles.fieldLabel}>Directory</Text>
            <TextInput
              accessibilityLabel="Project directory"
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setDirectory}
              onSubmitEditing={() => void createProject()}
              placeholder="/home/anoni/Code/example"
              placeholderTextColor="#64748b"
              returnKeyType="done"
              style={[styles.input, styles.directoryInput]}
              value={directory}
            />

            {error === null ? null : (
              <Text accessibilityLiveRegion="assertive" style={styles.error}>
                {error}
              </Text>
            )}

            <Pressable
              accessibilityHint="Registers this directory as a project"
              accessibilityLabel="Create project"
              accessibilityRole="button"
              accessibilityState={{ busy: creating, disabled: !formComplete || creating }}
              disabled={!formComplete || creating}
              onPress={() => void createProject()}
              style={({ pressed }) => [
                styles.createButton,
                (!formComplete || creating) && styles.buttonDisabled,
                pressed && formComplete && !creating && styles.buttonPressed,
              ]}
            >
              {creating ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.createButtonText}>Create project</Text>
              )}
            </Pressable>
          </View>
        </View>
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
    gap: 18,
    padding: 20,
  },
  header: {
    gap: 4,
  },
  title: {
    color: "#f8fafc",
    fontSize: 32,
    fontWeight: "800",
  },
  subtitle: {
    color: "#94a3b8",
    fontSize: 16,
  },
  content: {
    flex: 1,
    flexDirection: "row",
    gap: 18,
    minHeight: 0,
  },
  projectPanel: {
    flex: 1,
    gap: 12,
  },
  createPanel: {
    width: "38%",
    minWidth: 300,
    maxWidth: 460,
    alignSelf: "flex-start",
    gap: 10,
    borderRadius: 16,
    backgroundColor: "#0f1d2e",
    padding: 18,
  },
  sectionTitle: {
    color: "#e2e8f0",
    fontSize: 21,
    fontWeight: "700",
  },
  loader: {
    marginTop: 40,
  },
  projectList: {
    gap: 10,
    paddingBottom: 12,
  },
  emptyText: {
    color: "#94a3b8",
    fontSize: 17,
    paddingVertical: 28,
  },
  projectCard: {
    gap: 6,
    borderColor: "#1e3a52",
    borderWidth: 1,
    borderRadius: 14,
    backgroundColor: "#0f1d2e",
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  cardPressed: {
    backgroundColor: "#16324a",
  },
  projectName: {
    color: "#f8fafc",
    fontSize: 21,
    fontWeight: "700",
  },
  projectDirectory: {
    color: "#94a3b8",
    fontFamily: "monospace",
    fontSize: 13,
    lineHeight: 18,
  },
  fieldLabel: {
    color: "#cbd5e1",
    fontSize: 14,
    fontWeight: "600",
    marginTop: 4,
  },
  input: {
    minHeight: 48,
    borderColor: "#334155",
    borderWidth: 1,
    borderRadius: 10,
    backgroundColor: "#07111f",
    color: "#f8fafc",
    fontSize: 17,
    paddingHorizontal: 12,
  },
  directoryInput: {
    fontFamily: "monospace",
    fontSize: 14,
  },
  error: {
    color: "#fecaca",
    fontSize: 14,
    lineHeight: 19,
  },
  createButton: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "#0369a1",
    marginTop: 8,
  },
  buttonDisabled: {
    backgroundColor: "#334155",
    opacity: 0.65,
  },
  buttonPressed: {
    backgroundColor: "#0284c7",
  },
  createButtonText: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "800",
  },
});
