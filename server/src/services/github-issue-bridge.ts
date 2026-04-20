import type { Db } from "@paperclipai/db";
import { issueService } from "./issues.js";

export type GithubLabel = { name: string };

const PRIORITY_LABELS = ["critical", "high", "medium", "low"] as const;
type PaperclipPriority = (typeof PRIORITY_LABELS)[number];

/**
 * Scans a list of GitHub labels for a `priority:*` label and returns the
 * matching paperclip priority value.  Falls back to `"medium"` when no
 * priority label is present.
 */
export function mapGithubPriority(labels: GithubLabel[]): PaperclipPriority {
  for (const label of labels) {
    const lower = label.name.toLowerCase();
    for (const p of PRIORITY_LABELS) {
      if (lower === `priority:${p}`) return p;
    }
  }
  return "medium";
}

export interface GithubIssuePayload {
  title: string;
  body?: string | null;
  labels?: GithubLabel[];
}

export interface MirrorGithubIssueInput {
  companyId: string;
  projectId?: string | null;
  githubIssues: GithubIssuePayload[];
}

export function githubIssueBridgeService(db: Db) {
  return {
    /**
     * Mirror an array of GitHub issues into paperclip, mapping priority:*
     * labels onto the native priority field.
     */
    mirrorIssues: async (input: MirrorGithubIssueInput) => {
      const svc = issueService(db);
      const created = [];

      for (const ghIssue of input.githubIssues) {
        const labels = ghIssue.labels ?? [];
        const priority = mapGithubPriority(labels);

        const issue = await svc.create(input.companyId, {
          title: ghIssue.title,
          description: ghIssue.body ?? null,
          priority,
          projectId: input.projectId ?? null,
          status: "backlog",
        });

        created.push(issue);
      }

      return created;
    },
  };
}
