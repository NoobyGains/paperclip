import fs from "node:fs/promises";
import path from "node:path";

export async function firstExisting(repoPath: string, candidates: string[]): Promise<string | undefined> {
  for (const rel of candidates) {
    const abs = path.join(repoPath, rel);
    try {
      await fs.access(abs);
      return rel;
    } catch {
      /* not present */
    }
  }
  return undefined;
}
