import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createJsonProjectRepository } from "../src/projects.js";

async function temporaryDirectory(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "remote-deck-projects-"));
}

test("opens a missing store as an empty repository", async (context) => {
  const directory = await temporaryDirectory();
  context.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const repository = await createJsonProjectRepository(
    join(directory, "missing", "projects.json"),
  );

  assert.deepEqual(await repository.listProjects(), []);
  assert.equal(await repository.getProject("missing"), undefined);
});

test("creates parent directories and persists projects in insertion order", async (context) => {
  const directory = await temporaryDirectory();
  context.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const storePath = join(directory, "nested", "state", "projects.json");
  const projects = [
    { id: "first", name: "First", directory: "/work/first" },
    { id: "second", name: "Second", directory: "/work/second" },
  ];

  const repository = await createJsonProjectRepository(storePath);
  for (const project of projects) {
    await repository.addProject(project);
  }

  assert.equal(
    await readFile(storePath, "utf8"),
    `${JSON.stringify({ projects }, null, 2)}\n`,
  );
  const reopened = await createJsonProjectRepository(storePath);
  assert.deepEqual(await reopened.listProjects(), projects);
  assert.deepEqual(await reopened.getProject("second"), projects[1]);
});

test("returns a collection copy that cannot reorder repository state", async (context) => {
  const directory = await temporaryDirectory();
  context.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const repository = await createJsonProjectRepository(join(directory, "projects.json"));
  const first = { id: "first", name: "First", directory: "/work/first" };
  const second = { id: "second", name: "Second", directory: "/work/second" };
  await repository.addProject(first);
  await repository.addProject(second);

  const returnedProjects = await repository.listProjects();
  returnedProjects.reverse();
  returnedProjects.pop();

  assert.deepEqual(await repository.listProjects(), [first, second]);
});

test("propagates malformed and unreadable persisted stores", async (context) => {
  const directory = await temporaryDirectory();
  context.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const malformedPath = join(directory, "malformed.json");
  await writeFile(malformedPath, "not json", "utf8");

  await assert.rejects(
    () => createJsonProjectRepository(malformedPath),
    SyntaxError,
  );
  await assert.rejects(() => createJsonProjectRepository(directory));
});
