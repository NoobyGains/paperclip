import type { ProjectArchetype } from "@paperclipai/shared";
import fs from "node:fs/promises";
import path from "node:path";
import { firstExisting } from "./utils.js";

export async function detectRustCargo(repoPath: string): Promise<ProjectArchetype | null> {
  const cargoTomlPath = path.join(repoPath, "Cargo.toml");
  try {
    await fs.access(cargoTomlPath);
  } catch {
    return null;
  }

  const content = await fs.readFile(cargoTomlPath, "utf8").catch(() => "");

  // Detect workspace
  const isWorkspace = content.includes("[workspace]");
  const workspaces: string[] = [];
  if (isWorkspace) {
    const membersMatch = content.match(/members\s*=\s*\[([^\]]*)\]/s);
    if (membersMatch) {
      const members = membersMatch[1]
        .split(",")
        .map((m) => m.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
      workspaces.push(...members);
    }
  }

  return {
    stack: "rust-cargo",
    packageManager: "cargo",
    testCommand: "cargo test",
    buildCommand: "cargo build --release",
    lintCommand: "cargo clippy",
    archDocPath: await firstExisting(repoPath, [
      "doc/SPEC.md",
      "docs/ARCHITECTURE.md",
      "docs/SPEC.md",
      "ARCHITECTURE.md",
    ]),
    existingClaudeMd: await firstExisting(repoPath, ["CLAUDE.md"]),
    existingAgentsMd: await firstExisting(repoPath, ["AGENTS.md"]),
    workspaces: workspaces.length > 0 ? workspaces : undefined,
  };
}
