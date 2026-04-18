import type { ProjectArchetype } from "@paperclipai/shared";
import fs from "node:fs/promises";
import path from "node:path";
import { firstExisting } from "./utils.js";

export async function detectNpmSingle(repoPath: string): Promise<ProjectArchetype | null> {
  const pkgJsonPath = path.join(repoPath, "package.json");
  let pkg: Record<string, unknown> = {};
  try {
    pkg = JSON.parse(await fs.readFile(pkgJsonPath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }

  const scripts = (pkg.scripts ?? {}) as Record<string, string>;

  // Determine package manager: prefer yarn lockfile, then npm
  let packageManager = "npm";
  try {
    await fs.access(path.join(repoPath, "yarn.lock"));
    packageManager = "yarn";
  } catch {
    /* not yarn */
  }
  try {
    await fs.access(path.join(repoPath, "package-lock.json"));
    packageManager = "npm";
  } catch {
    /* ignore */
  }

  return {
    stack: "npm-single",
    packageManager,
    testCommand: (scripts.test ?? scripts["test:run"]) ? `${packageManager} test` : undefined,
    migrationCommand: scripts["db:migrate"] ? `${packageManager} run db:migrate` : undefined,
    lintCommand: scripts.lint ? `${packageManager} run lint` : undefined,
    buildCommand: scripts.build ? `${packageManager} run build` : undefined,
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
