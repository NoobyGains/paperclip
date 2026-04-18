import { PaperclipApiClient } from "./client.js";

export const TERMINAL_RUN_STATUSES = new Set<string>([
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
]);

export function ageMs(timestamp: string | null | undefined, nowMs: number): number | null {
  if (!timestamp) return null;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? nowMs - parsed : null;
}

export async function safeGet<T>(
  client: PaperclipApiClient,
  path: string,
): Promise<T | null> {
  try {
    return await client.requestJson<T>("GET", path);
  } catch {
    return null;
  }
}

export interface DiagnoseCompanyOptions {
  companyId?: string | null;
  approvalAgeWarnHours?: number;
}

export async function diagnoseCompany(
  client: PaperclipApiClient,
  options: DiagnoseCompanyOptions = {},
): Promise<unknown> {
  const now = Date.now();
  const resolvedCompanyId = client.resolveCompanyId(options.companyId ?? null);
  const warnHours = options.approvalAgeWarnHours ?? 24;
  const warnMs = warnHours * 60 * 60 * 1000;

  const [company, agentsRaw, approvalsRaw, activeIssuesRaw, routinesRaw] = await Promise.all([
    client.requestJson<Record<string, unknown>>("GET", `/companies/${resolvedCompanyId}`),
    safeGet<unknown>(client, `/companies/${resolvedCompanyId}/agents`),
    safeGet<unknown>(client, `/companies/${resolvedCompanyId}/approvals?status=pending`),
    safeGet<unknown>(client, `/companies/${resolvedCompanyId}/issues?status=in_progress`),
    safeGet<unknown>(client, `/companies/${resolvedCompanyId}/routines`),
  ]);

  const agents = Array.isArray(agentsRaw)
    ? (agentsRaw as Array<Record<string, unknown>>)
    : [];
  const pausedAgents = agents.filter((a) => a.status === "paused" || a.pauseReason);

  const approvals = Array.isArray(approvalsRaw)
    ? (approvalsRaw as Array<Record<string, unknown>>)
    : [];
  const overdueApprovals = approvals
    .map((a) => ({
      approval: a,
      ageMs: ageMs(typeof a.createdAt === "string" ? a.createdAt : null, now),
    }))
    .filter(({ ageMs: age }) => age !== null && age > warnMs);

  const activeIssues = Array.isArray(activeIssuesRaw)
    ? (activeIssuesRaw as Array<Record<string, unknown>>)
    : [];
  const issuesWithLocks = activeIssues.filter((i) => typeof i.executionRunId === "string");
  const candidateStaleIssues = await Promise.all(
    issuesWithLocks.map(async (issue) => {
      const runId = String(issue.executionRunId);
      const run = await safeGet<Record<string, unknown>>(
        client,
        `/heartbeat-runs/${encodeURIComponent(runId)}`,
      );
      const runStatus = typeof run?.status === "string" ? (run.status as string) : null;
      const stale = run === null || (runStatus !== null && TERMINAL_RUN_STATUSES.has(runStatus));
      return stale
        ? {
            id: issue.id,
            identifier: issue.identifier,
            status: issue.status,
            executionRunId: runId,
            runStatus,
            executionLockedAt: issue.executionLockedAt,
          }
        : null;
    }),
  );
  const staleLockIssues = candidateStaleIssues.filter((x) => x !== null);

  const routines = Array.isArray(routinesRaw)
    ? (routinesRaw as Array<Record<string, unknown>>)
    : [];
  const overdueRoutines = routines.filter((r) => {
    if (typeof r.nextRunAt !== "string") return false;
    const next = Date.parse(r.nextRunAt);
    return Number.isFinite(next) && next < now - warnMs;
  });

  return {
    company: {
      id: company.id,
      name: company.name,
      status: company.status,
      pauseReason: company.pauseReason,
      budgetMonthlyCents: company.budgetMonthlyCents,
      spentMonthlyCents: company.spentMonthlyCents,
      requireBoardApprovalForNewAgents: company.requireBoardApprovalForNewAgents,
      codexSandboxLoopbackEnabled: company.codexSandboxLoopbackEnabled,
    },
    pausedAgents: pausedAgents.map((a) => ({
      id: a.id,
      name: a.name,
      status: a.status,
      pauseReason: a.pauseReason,
    })),
    overdueApprovals: overdueApprovals.map(({ approval, ageMs: age }) => ({
      id: approval.id,
      type: approval.type,
      status: approval.status,
      createdAt: approval.createdAt,
      ageMs: age,
    })),
    staleLockIssues,
    overdueRoutines: overdueRoutines.map((r) => ({
      id: r.id,
      name: r.name,
      nextRunAt: r.nextRunAt,
      lastTriggeredAt: r.lastTriggeredAt,
    })),
    summary: {
      pausedAgentCount: pausedAgents.length,
      overdueApprovalCount: overdueApprovals.length,
      staleLockCount: staleLockIssues.length,
      overdueRoutineCount: overdueRoutines.length,
      approvalAgeWarnHours: warnHours,
    },
  };
}
