import type { ProjectArchetype } from "@paperclipai/shared";
import fs from "node:fs/promises";
import path from "node:path";
import { firstExisting } from "./utils.js";

export async function detectPythonPoetry(repoPath: string): Promise<ProjectArchetype | null> {
  const pyprojectPath = path.join(repoPath, "pyproject.toml");
  try {
    await fs.access(pyprojectPath);
  } catch {
    return null;
  }

  const content = await fs.readFile(pyprojectPath, "utf8").catch(() => "");
  const hasPoetry = content.includes("[tool.poetry]") || content.includes("[build-system]");
  if (!hasPoetry) return null;

  // Detect test command — look for pytest or unittest references
  const testCommand = content.includes("pytest")
    ? "poetry run pytest"
    : undefined;

  return {
    stack: "python-poetry",
    packageManager: "poetry",
    testCommand,
    lintCommand: (content.includes("ruff") || content.includes("flake8")) ? "poetry run ruff check ." : undefined,
    buildCommand: "poetry build",
    archDocPath: await firstExisting(repoPath, [
      "doc/SPEC.md",
      "docs/ARCHITECTURE.md",
      "docs/SPEC.md",
      "ARCHITECTURE.md",
    ]),
    existingClaudeMd: await firstExisting(repoPath, ["CLAUDE.md"]),
    existingAgentsMd: await firstExisting(repoPath, ["AGENTS.md"]),
  };
}
