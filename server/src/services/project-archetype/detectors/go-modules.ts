import type { ProjectArchetype } from "@paperclipai/shared";
import fs from "node:fs/promises";
import path from "node:path";
import { firstExisting } from "./utils.js";

export async function detectGoModules(repoPath: string): Promise<ProjectArchetype | null> {
  const goModPath = path.join(repoPath, "go.mod");
  try {
    await fs.access(goModPath);
  } catch {
    return null;
  }

  return {
    stack: "go-modules",
    packageManager: "go",
    testCommand: "go test ./...",
    buildCommand: "go build ./...",
    lintCommand: "golangci-lint run",
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
