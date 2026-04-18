import fs from "node:fs/promises";
import { readCeoOverlayFile, isCeoOverlayFile } from "./ceo-overlay.js";

const DEFAULT_AGENT_BUNDLE_FILES = {
  default: ["AGENTS.md"],
  ceo: ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"],
} as const;

type DefaultAgentBundleRole = keyof typeof DEFAULT_AGENT_BUNDLE_FILES;

function resolveDefaultAgentBundleUrl(role: DefaultAgentBundleRole, fileName: string) {
  return new URL(`../onboarding-assets/${role}/${fileName}`, import.meta.url);
}

export async function loadDefaultAgentInstructionsBundle(
  role: DefaultAgentBundleRole,
  opts?: { projectRepoPath?: string | null },
): Promise<Record<string, string>> {
  const fileNames = DEFAULT_AGENT_BUNDLE_FILES[role];
  const entries = await Promise.all(
    fileNames.map(async (fileName) => {
      // Per-project overlay takes precedence for CEO files when projectRepoPath is set.
      if (role === "ceo" && opts?.projectRepoPath && isCeoOverlayFile(fileName)) {
        const overlay = await readCeoOverlayFile(opts.projectRepoPath, fileName);
        if (overlay !== null) return [fileName, overlay] as const;
      }
      const defaultContent = await fs.readFile(
        resolveDefaultAgentBundleUrl(role, fileName),
        "utf8",
      );
      return [fileName, defaultContent] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export function resolveDefaultAgentInstructionsBundleRole(role: string): DefaultAgentBundleRole {
  return role === "ceo" ? "ceo" : "default";
}
