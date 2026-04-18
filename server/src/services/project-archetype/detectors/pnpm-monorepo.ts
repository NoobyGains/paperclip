import type { ProjectArchetype } from "@paperclipai/shared";
import fs from "node:fs/promises";
import path from "node:path";
import { firstExisting } from "./utils.js";

export async function detectPnpmMonorepo(repoPath: string): Promise<ProjectArchetype | null> {
  const pnpmWorkspace = path.join(repoPath, "pnpm-workspace.yaml");
  try {
    await fs.access(pnpmWorkspace);
  } catch {
    return null;
  }
  // confirmed pnpm monorepo — read package.json for scripts, workspaces
  const pkgJsonPath = path.join(repoPath, "package.json");
  let pkg: Record<string, unknown> = {};
  try {
    pkg = JSON.parse(await fs.readFile(pkgJsonPath, "utf8")) as Record<string, unknown>;
  } catch {
    /* acceptable — still valid pnpm monorepo without package.json scripts */
  }
  const scripts = (pkg.scripts ?? {}) as Record<string, string>;
  // workspaces from pnpm-workspace.yaml; keep simple — look for `packages:` entries
  const wsYaml = await fs.readFile(pnpmWorkspace, "utf8").catch(() => "");
  const workspaces = wsYaml
    .split("\n")
    .map((line) => line.match(/^\s*-\s*['"]?([^'"#\s]+)['"]?/)?.[1])
    .filter((x): x is string => Boolean(x));

  return {
    stack: "pnpm-monorepo",
    packageManager: "pnpm",
    testCommand: (scripts.test ?? scripts["test:run"]) ? "pnpm test" : undefined,
    migrationCommand: scripts["db:migrate"] ? "pnpm db:migrate" : undefined,
    lintCommand: scripts.lint ? "pnpm lint" : undefined,
    buildCommand: scripts.build ? "pnpm build" : undefined,
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
