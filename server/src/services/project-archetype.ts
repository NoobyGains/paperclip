import type { ProjectArchetype } from "@paperclipai/shared";
import {
  detectPnpmMonorepo,
  detectNpmSingle,
  detectPythonPoetry,
  detectRustCargo,
  detectGoModules,
  detectDotnet,
} from "./project-archetype/detectors/index.js";

// Order matters — more specific detectors first. pnpm-monorepo before npm-single
// because both match a package.json; the monorepo signal is `pnpm-workspace.yaml`.
const detectors = [
  detectPnpmMonorepo,
  detectRustCargo,
  detectGoModules,
  detectPythonPoetry,
  detectDotnet,
  detectNpmSingle,
];

export async function detectArchetype(repoPath: string): Promise<ProjectArchetype> {
  for (const detector of detectors) {
    const result = await detector(repoPath);
    if (result) return result;
  }
  return { stack: "unknown" };
}
