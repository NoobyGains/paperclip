import fs from "node:fs/promises";
import path from "node:path";

const CEO_OVERLAY_FILES = ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"] as const;
type CeoOverlayFile = (typeof CEO_OVERLAY_FILES)[number];

export function isCeoOverlayFile(name: string): name is CeoOverlayFile {
  return (CEO_OVERLAY_FILES as readonly string[]).includes(name);
}

export async function readCeoOverlayFile(
  projectRepoPath: string,
  fileName: CeoOverlayFile,
): Promise<string | null> {
  const overlayPath = path.join(projectRepoPath, ".paperclip", "ceo", fileName);
  try {
    return await fs.readFile(overlayPath, "utf8");
  } catch {
    return null;
  }
}

export async function writeCeoOverlayFiles(
  projectRepoPath: string,
  files: Partial<Record<CeoOverlayFile, string>>,
): Promise<string[]> {
  const overlayDir = path.join(projectRepoPath, ".paperclip", "ceo");
  await fs.mkdir(overlayDir, { recursive: true });
  const written: string[] = [];
  for (const [name, content] of Object.entries(files)) {
    if (!isCeoOverlayFile(name) || typeof content !== "string") continue;
    const filePath = path.join(overlayDir, name);
    await fs.writeFile(filePath, content, "utf8");
    written.push(name);
  }
  return written;
}

export interface RefineCeoOverlayResult {
  written: string[];
  historyEntries: string[];
  repoPath: string;
}

export async function refineCeoOverlayFiles(
  projectRepoPath: string,
  changes: Partial<Record<CeoOverlayFile, string>>,
): Promise<RefineCeoOverlayResult> {
  const overlayDir = path.join(projectRepoPath, ".paperclip", "ceo");
  const historyDir = path.join(overlayDir, ".history");
  await fs.mkdir(historyDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const written: string[] = [];
  const historyEntries: string[] = [];

  for (const [name, content] of Object.entries(changes)) {
    if (!isCeoOverlayFile(name) || typeof content !== "string") continue;

    const filePath = path.join(overlayDir, name);
    // Capture previous contents before overwriting.
    try {
      const previous = await fs.readFile(filePath, "utf8");
      const historyName = `${timestamp}-${name}`;
      const historyPath = path.join(historyDir, historyName);
      await fs.writeFile(historyPath, previous, "utf8");
      historyEntries.push(historyName);
    } catch {
      // No previous file — nothing to archive.
    }

    await fs.writeFile(filePath, content, "utf8");
    written.push(name);
  }

  return { written, historyEntries, repoPath: projectRepoPath };
}

export { CEO_OVERLAY_FILES };
