import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { issues as issuesTable } from "@paperclipai/db";
import { agentService } from "./agents.js";
import { issueService } from "./issues.js";
import { projectService } from "./projects.js";
import { execGh } from "../lib/exec-gh.js";

const execFileAsync = promisify(execFile);

export interface GithubIssueLabel {
  name: string;
}

export interface GithubIssue {
  number: number;
  title: string;
  body: string | null;
  labels: GithubIssueLabel[];
  url: string;
}

export interface GithubIssueBridgeResult {
  imported: number;
  skippedAlreadyMirrored: number;
  createdIssueIds: string[];
  warnings: string[];
}

export interface GithubIssueBridgeDependencies {
  projectService?: ReturnType<typeof projectService>;
  issueService?: ReturnType<typeof issueService>;
  agentService?: ReturnType<typeof agentService>;
  execGh?: typeof execGh;
  detectGitHubRepo?: typeof detectGitHubRepo;
}

interface GithubBridgeConfig {
  enabled: boolean;
  labelFilter?: string[] | null;
  agentIdOverride?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readGithubIssueNumber(metadata: unknown): number | null {
  if (!isRecord(metadata)) return null;
  const raw = metadata.githubIssueNumber;
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.trunc(raw);
  if (typeof raw === "string" && raw.trim().length > 0) {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }
  return null;
}

function readGithubIssueLabels(issue: GithubIssue): string[] {
  return issue.labels
    .map((label) => label.name.trim())
    .filter((label) => label.length > 0);
}

function normalizeLabelSet(values: string[] | null | undefined): Set<string> {
  return new Set(
    (values ?? [])
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0),
  );
}

function buildIssueDescription(issue: GithubIssue): string {
  const labels = readGithubIssueLabels(issue);
  return [
    `Mirrored from ${issue.url}`,
    "",
    `Labels: ${labels.length > 0 ? labels.join(", ") : "(none)"}`,
    "",
    "---",
    "",
    issue.body?.trim() ?? "",
  ].join("\n");
}

function parseGitHubRemoteUrl(remoteUrl: string | null | undefined): string | null {
  if (!remoteUrl) return null;
  const trimmed = remoteUrl.trim();
  if (trimmed.length === 0) return null;

  try {
    const parsed = new URL(trimmed);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname !== "github.com" && hostname !== "www.github.com") return null;
    const parts = parsed.pathname.replace(/^\/+/, "").replace(/\.git$/i, "").split("/").filter(Boolean);
    if (parts.length < 2) return null;
    return `${parts[0]}/${parts[1]}`;
  } catch {
    const scpMatch = trimmed.match(/^(?:[^@]+@)?([^:]+):(.+)$/);
    if (!scpMatch) return null;
    const hostname = scpMatch[1]!.toLowerCase();
    if (hostname !== "github.com" && hostname !== "www.github.com") return null;
    const parts = scpMatch[2]!.replace(/^\/+/, "").replace(/\.git$/i, "").split("/").filter(Boolean);
    if (parts.length < 2) return null;
    return `${parts[0]}/${parts[1]}`;
  }
}

async function runGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
      cwd,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    return typeof stdout === "string" ? stdout.trim() : "";
  } catch {
    return null;
  }
}

export async function detectGitHubRepo(cwd: string): Promise<string | null> {
  const remotes = await runGit(cwd, ["remote"]);
  if (!remotes) return null;

  const remoteNames = remotes
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const orderedRemoteNames = [
    ...remoteNames.filter((entry) => entry === "origin"),
    ...remoteNames.filter((entry) => entry !== "origin"),
  ];

  for (const remoteName of orderedRemoteNames) {
    const remoteUrl = await runGit(cwd, ["remote", "get-url", remoteName]);
    const repo = parseGitHubRemoteUrl(remoteUrl);
    if (repo) return repo;
  }

  return null;
}

function readGithubBridgeConfig(project: {
  primaryWorkspace: { runtimeConfig?: { githubBridge?: GithubBridgeConfig | null } | null } | null;
}) {
  const raw = project.primaryWorkspace?.runtimeConfig?.githubBridge ?? null;
  if (!raw || typeof raw.enabled !== "boolean") return null;
  return raw;
}

async function resolveAssigneeAgentId(input: {
  companyId: string;
  agentSvc: ReturnType<typeof agentService>;
  githubBridgeConfig: GithubBridgeConfig | null;
  warnings: string[];
}): Promise<string | null> {
  const agents = await input.agentSvc.list(input.companyId);
  const activeAgents = agents.filter((agent) => agent.status !== "terminated");
  const activeById = new Map(activeAgents.map((agent) => [agent.id, agent]));
  const overrideAgentId = input.githubBridgeConfig?.agentIdOverride ?? null;
  if (overrideAgentId) {
    const overrideAgent = activeById.get(overrideAgentId) ?? null;
    if (overrideAgent) return overrideAgent.id;
    input.warnings.push(`githubBridge.agentIdOverride ${overrideAgentId} was not found or is inactive; falling back to CEO`);
  }
  const ceo = activeAgents.find((agent) => agent.role === "ceo") ?? null;
  return ceo?.id ?? null;
}

export function githubIssueBridge(db: Db, deps: GithubIssueBridgeDependencies = {}) {
  const projects = deps.projectService ?? projectService(db);
  const issues = deps.issueService ?? issueService(db);
  const agentsSvc = deps.agentService ?? agentService(db);
  const runGh = deps.execGh ?? execGh;
  const resolveRepo = deps.detectGitHubRepo ?? detectGitHubRepo;

  return {
    async syncProject(
      projectId: string,
      actor?: { actorId?: string | null; agentId?: string | null },
    ): Promise<GithubIssueBridgeResult> {
      const project = await projects.getById(projectId);
      if (!project) {
        throw new Error("project not found");
      }

      const warnings: string[] = [];
      const workspace = project.primaryWorkspace ?? null;
      if (!workspace?.cwd) {
        return {
          imported: 0,
          skippedAlreadyMirrored: 0,
          createdIssueIds: [],
          warnings: ["no workspace cwd; skipping"],
        };
      }

      const ghRepo = await resolveRepo(workspace.cwd);
      if (!ghRepo) {
        return {
          imported: 0,
          skippedAlreadyMirrored: 0,
          createdIssueIds: [],
          warnings: ["workspace has no github.com remote"],
        };
      }

      const ghIssues = await runGh<GithubIssue[]>(
        [
          "issue",
          "list",
          "--repo",
          ghRepo,
          "--state",
          "open",
          "--limit",
          "200",
          "--json",
          "number,title,body,labels,url",
        ],
        { cwd: workspace.cwd },
      );

      const bridgeConfig = readGithubBridgeConfig(project);
      const labelFilter = normalizeLabelSet(bridgeConfig?.labelFilter ?? null);
      const assigneeAgentId = await resolveAssigneeAgentId({
        companyId: project.companyId,
        agentSvc: agentsSvc,
        githubBridgeConfig: bridgeConfig,
        warnings,
      });

      const existingIssues = await db
        .select({
          metadata: issuesTable.metadata,
          originKind: issuesTable.originKind,
          originId: issuesTable.originId,
        })
        .from(issuesTable)
        .where(and(eq(issuesTable.companyId, project.companyId), eq(issuesTable.projectId, project.id)));
      const existingGhNumbers = new Set<number>();
      for (const issue of existingIssues) {
        const number = readGithubIssueNumber(issue.metadata);
        if (number !== null) existingGhNumbers.add(number);
        if (issue.originKind === "github_issue" && issue.originId) {
          const originMatch = issue.originId.match(/#(\d+)$/);
          if (originMatch?.[1]) {
            existingGhNumbers.add(Number(originMatch[1]));
          }
        }
      }

      const createdIssueIds: string[] = [];
      let skippedAlreadyMirrored = 0;

      for (const ghIssue of ghIssues) {
        const labelNames = readGithubIssueLabels(ghIssue);
        if (labelFilter.size > 0) {
          const comparableLabels = normalizeLabelSet(labelNames);
          const matchesFilter = [...comparableLabels].some((label) => labelFilter.has(label));
          if (!matchesFilter) continue;
        }

        if (existingGhNumbers.has(ghIssue.number)) {
          skippedAlreadyMirrored += 1;
          continue;
        }

        const createdIssue = await issues.create(project.companyId, {
          title: `[GH#${ghIssue.number}] ${ghIssue.title}`,
          description: buildIssueDescription(ghIssue),
          assigneeAgentId,
          projectId: project.id,
          status: "todo",
          priority: "medium",
          metadata: {
            githubIssueNumber: ghIssue.number,
            githubUrl: ghIssue.url,
            githubRepo: ghRepo,
            githubLabels: labelNames,
          },
          originKind: "github_issue",
          originId: `${ghRepo}#${ghIssue.number}`,
          createdByAgentId: actor?.agentId ?? null,
          createdByUserId: actor?.agentId ? null : actor?.actorId ?? null,
        });

        createdIssueIds.push(createdIssue.id);
        existingGhNumbers.add(ghIssue.number);
      }

      return {
        imported: createdIssueIds.length,
        skippedAlreadyMirrored,
        createdIssueIds,
        warnings,
      };
    },
  };
}

export { parseGitHubRemoteUrl };
