import type { ProjectArchetype } from "@paperclipai/shared";
import fs from "node:fs/promises";
import path from "node:path";
import { firstExisting } from "./utils.js";

export async function detectDotnet(repoPath: string): Promise<ProjectArchetype | null> {
  // Look for any .csproj, .fsproj, or .vbproj file in the root directory
  let found = false;
  try {
    const entries = await fs.readdir(repoPath);
    found = entries.some((e) => /\.(csproj|fsproj|vbproj|sln)$/.test(e));
  } catch {
    return null;
  }
  if (!found) return null;

  return {
    stack: "dotnet",
    packageManager: "dotnet",
    testCommand: "dotnet test",
    buildCommand: "dotnet build",
    lintCommand: undefined,
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
