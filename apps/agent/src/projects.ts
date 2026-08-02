/**
 * Project persistence contracts and the current JSON-backed implementation.
 *
 * The rest of the agent depends on `ProjectRepository`, so replacing the JSON
 * file with a database does not require changes to HTTP routes or tmux logic.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** A user-visible workspace and the directory shared by all of its tmux windows. */
export interface Project {
  id: string;
  name: string;
  directory: string;
}

/**
 * Storage boundary for projects.
 *
 * Every operation is asynchronous so a future database implementation can use
 * the same contract without forcing callers to change.
 */
export interface ProjectRepository {
  /** Returns all known projects in display order. */
  listProjects(): Promise<Project[]>;

  /** Finds one project by its stable identifier. */
  getProject(projectId: string): Promise<Project | undefined>;

  /** Persists a newly created project. */
  addProject(project: Project): Promise<void>;
}

/** Keeps projects in memory while persisting the collection to one JSON file. */
class JsonProjectRepository implements ProjectRepository {
  private constructor(
    private readonly path: string,
    private readonly projects: Project[],
  ) {}

  /** Loads the current JSON file once and returns a ready repository. */
  static async open(path: string): Promise<JsonProjectRepository> {
    return new JsonProjectRepository(path, await readProjects(path));
  }

  /** Returns a copy so callers cannot mutate the repository's collection directly. */
  async listProjects(): Promise<Project[]> {
    return [...this.projects];
  }

  /** Looks up a project in the in-memory collection loaded at startup. */
  async getProject(projectId: string): Promise<Project | undefined> {
    return this.projects.find((project) => project.id === projectId);
  }

  /** Adds a project to memory and writes the updated collection to disk. */
  async addProject(project: Project): Promise<void> {
    this.projects.push(project);
    await writeProjects(this.path, this.projects);
  }
}

/** Reads the persisted collection, treating a missing file as an empty repository. */
async function readProjects(path: string): Promise<Project[]> {
  try {
    const contents = await readFile(path, "utf8");
    return (JSON.parse(contents) as { projects: Project[] }).projects;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

/** Writes the complete collection in a human-readable format. */
async function writeProjects(path: string, projects: Project[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ projects }, null, 2)}\n`, "utf8");
}

/** Creates the current repository implementation behind the storage interface. */
export async function createJsonProjectRepository(
  path: string,
): Promise<ProjectRepository> {
  return await JsonProjectRepository.open(path);
}
