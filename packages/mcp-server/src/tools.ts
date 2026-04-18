import { z } from "zod";
import {
  addIssueCommentSchema,
  checkoutIssueSchema,
  createAgentHireSchema,
  createApprovalSchema,
  createIssueSchema,
  updateCompanySchema,
  updateIssueSchema,
  upsertIssueDocumentSchema,
  linkIssueApprovalSchema,
  companyPortabilityImportSchema,
} from "@paperclipai/shared";
import { PaperclipApiClient } from "./client.js";
import {
  TERMINAL_RUN_STATUSES,
  ageMs,
  diagnoseCompany,
  safeGet,
} from "./diagnostics.js";
import { formatErrorResponse, formatTextResponse } from "./format.js";

export interface ToolDefinition {
  name: string;
  description: string;
  schema: z.AnyZodObject;
  execute: (input: Record<string, unknown>) => Promise<{
    content: Array<{ type: "text"; text: string }>;
  }>;
}

function makeTool<TSchema extends z.ZodRawShape>(
  name: string,
  description: string,
  schema: z.ZodObject<TSchema>,
  execute: (input: z.infer<typeof schema>) => Promise<unknown>,
): ToolDefinition {
  return {
    name,
    description,
    schema,
    execute: async (input) => {
      try {
        const parsed = schema.parse(input);
        return formatTextResponse(await execute(parsed));
      } catch (error) {
        return formatErrorResponse(error);
      }
    },
  };
}

function parseOptionalJson(raw: string | undefined | null): unknown {
  if (!raw || raw.trim().length === 0) return undefined;
  return JSON.parse(raw);
}

const companyIdOptional = z.string().uuid().optional().nullable();
const agentIdOptional = z.string().uuid().optional().nullable();
const issueIdSchema = z.string().min(1);
const projectIdSchema = z.string().min(1);
const goalIdSchema = z.string().uuid();
const approvalIdSchema = z.string().uuid();
const documentKeySchema = z.string().trim().min(1).max(64);

const listIssuesSchema = z.object({
  companyId: companyIdOptional,
  status: z.string().optional(),
  projectId: z.string().uuid().optional(),
  assigneeAgentId: z.string().uuid().optional(),
  participantAgentId: z.string().uuid().optional(),
  assigneeUserId: z.string().optional(),
  touchedByUserId: z.string().optional(),
  inboxArchivedByUserId: z.string().optional(),
  unreadForUserId: z.string().optional(),
  labelId: z.string().uuid().optional(),
  executionWorkspaceId: z.string().uuid().optional(),
  originKind: z.string().optional(),
  originId: z.string().optional(),
  includeRoutineExecutions: z.boolean().optional(),
  q: z.string().optional(),
});

const listCommentsSchema = z.object({
  issueId: issueIdSchema,
  after: z.string().uuid().optional(),
  order: z.enum(["asc", "desc"]).optional(),
  limit: z.number().int().positive().max(500).optional(),
});

const upsertDocumentToolSchema = z.object({
  issueId: issueIdSchema,
  key: documentKeySchema,
  title: z.string().trim().max(200).nullable().optional(),
  format: z.enum(["markdown"]).default("markdown"),
  body: z.string().max(524288),
  changeSummary: z.string().trim().max(500).nullable().optional(),
  baseRevisionId: z.string().uuid().nullable().optional(),
});

const createIssueToolSchema = z.object({
  companyId: companyIdOptional,
}).merge(createIssueSchema);

const updateIssueToolSchema = z.object({
  issueId: issueIdSchema,
}).merge(updateIssueSchema);

const checkoutIssueToolSchema = z.object({
  issueId: issueIdSchema,
  agentId: agentIdOptional,
  expectedStatuses: checkoutIssueSchema.shape.expectedStatuses.optional(),
});

const addCommentToolSchema = z.object({
  issueId: issueIdSchema,
}).merge(addIssueCommentSchema);

const approvalDecisionSchema = z.object({
  approvalId: approvalIdSchema,
  action: z.enum(["approve", "reject", "requestRevision", "resubmit"]),
  decisionNote: z.string().optional(),
  payloadJson: z.string().optional(),
});

const createApprovalToolSchema = z.object({
  companyId: companyIdOptional,
}).merge(createApprovalSchema);

const apiRequestSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z.string().min(1),
  jsonBody: z.string().optional(),
});

const createAgentHireToolSchema = z.object({
  companyId: companyIdOptional,
}).merge(createAgentHireSchema);

const updateCompanySettingsToolSchema = z.object({
  companyId: companyIdOptional,
}).merge(updateCompanySchema);

const previewCompanyImportToolSchema = z.object({
  companyId: companyIdOptional,
}).merge(companyPortabilityImportSchema);

const forceReleaseExecutionLockSchema = z.object({
  issueId: issueIdSchema,
  reason: z.string().trim().min(1).max(1000),
});

const diagnoseIssueSchema = z.object({
  issueId: issueIdSchema,
});

const diagnoseAgentSchema = z.object({
  agentId: z.string().min(1),
  recentRunLimit: z.number().int().min(1).max(50).optional().default(10),
});

const diagnoseCompanySchema = z.object({
  companyId: companyIdOptional,
  approvalAgeWarnHours: z.number().int().min(1).max(720).optional().default(24),
});


export function createToolDefinitions(client: PaperclipApiClient): ToolDefinition[] {
  return [
    makeTool(
      "paperclipMe",
      "Get the current authenticated Paperclip actor details",
      z.object({}),
      async () => client.requestJson("GET", "/agents/me"),
    ),
    makeTool(
      "paperclipInboxLite",
      "Get the current authenticated agent inbox-lite assignment list",
      z.object({}),
      async () => client.requestJson("GET", "/agents/me/inbox-lite"),
    ),
    makeTool(
      "paperclipListAgents",
      "List agents in a company",
      z.object({ companyId: companyIdOptional }),
      async ({ companyId }) => client.requestJson("GET", `/companies/${client.resolveCompanyId(companyId)}/agents`),
    ),
    makeTool(
      "paperclipGetAgent",
      "Get a single agent by id",
      z.object({ agentId: z.string().min(1), companyId: companyIdOptional }),
      async ({ agentId, companyId }) => {
        const qs = companyId ? `?companyId=${encodeURIComponent(companyId)}` : "";
        return client.requestJson("GET", `/agents/${encodeURIComponent(agentId)}${qs}`);
      },
    ),
    makeTool(
      "paperclipListIssues",
      "List issues for a company with optional filters",
      listIssuesSchema,
      async (input) => {
        const companyId = client.resolveCompanyId(input.companyId);
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(input)) {
          if (key === "companyId" || value === undefined || value === null) continue;
          params.set(key, String(value));
        }
        const qs = params.toString();
        return client.requestJson("GET", `/companies/${companyId}/issues${qs ? `?${qs}` : ""}`);
      },
    ),
    makeTool(
      "paperclipGetIssue",
      "Get a single issue by UUID or identifier",
      z.object({ issueId: issueIdSchema }),
      async ({ issueId }) => client.requestJson("GET", `/issues/${encodeURIComponent(issueId)}`),
    ),
    makeTool(
      "paperclipGetHeartbeatContext",
      "Get compact heartbeat context for an issue",
      z.object({ issueId: issueIdSchema, wakeCommentId: z.string().uuid().optional() }),
      async ({ issueId, wakeCommentId }) => {
        const qs = wakeCommentId ? `?wakeCommentId=${encodeURIComponent(wakeCommentId)}` : "";
        return client.requestJson("GET", `/issues/${encodeURIComponent(issueId)}/heartbeat-context${qs}`);
      },
    ),
    makeTool(
      "paperclipListComments",
      "List issue comments with incremental options",
      listCommentsSchema,
      async ({ issueId, after, order, limit }) => {
        const params = new URLSearchParams();
        if (after) params.set("after", after);
        if (order) params.set("order", order);
        if (limit) params.set("limit", String(limit));
        const qs = params.toString();
        return client.requestJson("GET", `/issues/${encodeURIComponent(issueId)}/comments${qs ? `?${qs}` : ""}`);
      },
    ),
    makeTool(
      "paperclipGetComment",
      "Get a specific issue comment by id",
      z.object({ issueId: issueIdSchema, commentId: z.string().uuid() }),
      async ({ issueId, commentId }) =>
        client.requestJson("GET", `/issues/${encodeURIComponent(issueId)}/comments/${encodeURIComponent(commentId)}`),
    ),
    makeTool(
      "paperclipListIssueApprovals",
      "List approvals linked to an issue",
      z.object({ issueId: issueIdSchema }),
      async ({ issueId }) => client.requestJson("GET", `/issues/${encodeURIComponent(issueId)}/approvals`),
    ),
    makeTool(
      "paperclipListDocuments",
      "List issue documents",
      z.object({ issueId: issueIdSchema }),
      async ({ issueId }) => client.requestJson("GET", `/issues/${encodeURIComponent(issueId)}/documents`),
    ),
    makeTool(
      "paperclipGetDocument",
      "Get one issue document by key",
      z.object({ issueId: issueIdSchema, key: documentKeySchema }),
      async ({ issueId, key }) =>
        client.requestJson("GET", `/issues/${encodeURIComponent(issueId)}/documents/${encodeURIComponent(key)}`),
    ),
    makeTool(
      "paperclipListDocumentRevisions",
      "List revisions for an issue document",
      z.object({ issueId: issueIdSchema, key: documentKeySchema }),
      async ({ issueId, key }) =>
        client.requestJson(
          "GET",
          `/issues/${encodeURIComponent(issueId)}/documents/${encodeURIComponent(key)}/revisions`,
        ),
    ),
    makeTool(
      "paperclipListProjects",
      "List projects in a company",
      z.object({ companyId: companyIdOptional }),
      async ({ companyId }) => client.requestJson("GET", `/companies/${client.resolveCompanyId(companyId)}/projects`),
    ),
    makeTool(
      "paperclipGetProject",
      "Get a project by id or company-scoped short reference",
      z.object({ projectId: projectIdSchema, companyId: companyIdOptional }),
      async ({ projectId, companyId }) => {
        const qs = companyId ? `?companyId=${encodeURIComponent(companyId)}` : "";
        return client.requestJson("GET", `/projects/${encodeURIComponent(projectId)}${qs}`);
      },
    ),
    makeTool(
      "paperclipListGoals",
      "List goals in a company",
      z.object({ companyId: companyIdOptional }),
      async ({ companyId }) => client.requestJson("GET", `/companies/${client.resolveCompanyId(companyId)}/goals`),
    ),
    makeTool(
      "paperclipGetGoal",
      "Get a goal by id",
      z.object({ goalId: goalIdSchema }),
      async ({ goalId }) => client.requestJson("GET", `/goals/${encodeURIComponent(goalId)}`),
    ),
    makeTool(
      "paperclipListApprovals",
      "List approvals in a company",
      z.object({ companyId: companyIdOptional, status: z.string().optional() }),
      async ({ companyId, status }) => {
        const qs = status ? `?status=${encodeURIComponent(status)}` : "";
        return client.requestJson("GET", `/companies/${client.resolveCompanyId(companyId)}/approvals${qs}`);
      },
    ),
    makeTool(
      "paperclipCreateApproval",
      "Create a board approval request, optionally linked to one or more issues",
      createApprovalToolSchema,
      async ({ companyId, ...body }) =>
        client.requestJson("POST", `/companies/${client.resolveCompanyId(companyId)}/approvals`, {
          body,
        }),
    ),
    makeTool(
      "paperclipGetApproval",
      "Get an approval by id",
      z.object({ approvalId: approvalIdSchema }),
      async ({ approvalId }) => client.requestJson("GET", `/approvals/${encodeURIComponent(approvalId)}`),
    ),
    makeTool(
      "paperclipGetApprovalIssues",
      "List issues linked to an approval",
      z.object({ approvalId: approvalIdSchema }),
      async ({ approvalId }) => client.requestJson("GET", `/approvals/${encodeURIComponent(approvalId)}/issues`),
    ),
    makeTool(
      "paperclipListApprovalComments",
      "List comments for an approval",
      z.object({ approvalId: approvalIdSchema }),
      async ({ approvalId }) => client.requestJson("GET", `/approvals/${encodeURIComponent(approvalId)}/comments`),
    ),
    makeTool(
      "paperclipCreateIssue",
      "Create a new issue",
      createIssueToolSchema,
      async ({ companyId, ...body }) =>
        client.requestJson("POST", `/companies/${client.resolveCompanyId(companyId)}/issues`, { body }),
    ),
    makeTool(
      "paperclipUpdateIssue",
      "Patch an issue, optionally including a comment",
      updateIssueToolSchema,
      async ({ issueId, ...body }) =>
        client.requestJson("PATCH", `/issues/${encodeURIComponent(issueId)}`, { body }),
    ),
    makeTool(
      "paperclipCheckoutIssue",
      "Checkout an issue for an agent",
      checkoutIssueToolSchema,
      async ({ issueId, agentId, expectedStatuses }) =>
        client.requestJson("POST", `/issues/${encodeURIComponent(issueId)}/checkout`, {
          body: {
            agentId: client.resolveAgentId(agentId),
            expectedStatuses: expectedStatuses ?? ["todo", "backlog", "blocked"],
          },
        }),
    ),
    makeTool(
      "paperclipReleaseIssue",
      "Release an issue checkout",
      z.object({ issueId: issueIdSchema }),
      async ({ issueId }) => client.requestJson("POST", `/issues/${encodeURIComponent(issueId)}/release`, { body: {} }),
    ),
    makeTool(
      "paperclipAddComment",
      "Add a comment to an issue",
      addCommentToolSchema,
      async ({ issueId, ...body }) =>
        client.requestJson("POST", `/issues/${encodeURIComponent(issueId)}/comments`, { body }),
    ),
    makeTool(
      "paperclipUpsertIssueDocument",
      "Create or update an issue document",
      upsertDocumentToolSchema,
      async ({ issueId, key, ...body }) =>
        client.requestJson(
          "PUT",
          `/issues/${encodeURIComponent(issueId)}/documents/${encodeURIComponent(key)}`,
          { body },
        ),
    ),
    makeTool(
      "paperclipRestoreIssueDocumentRevision",
      "Restore a prior revision of an issue document",
      z.object({
        issueId: issueIdSchema,
        key: documentKeySchema,
        revisionId: z.string().uuid(),
      }),
      async ({ issueId, key, revisionId }) =>
        client.requestJson(
          "POST",
          `/issues/${encodeURIComponent(issueId)}/documents/${encodeURIComponent(key)}/revisions/${encodeURIComponent(revisionId)}/restore`,
          { body: {} },
        ),
    ),
    makeTool(
      "paperclipLinkIssueApproval",
      "Link an approval to an issue",
      z.object({ issueId: issueIdSchema }).merge(linkIssueApprovalSchema),
      async ({ issueId, approvalId }) =>
        client.requestJson("POST", `/issues/${encodeURIComponent(issueId)}/approvals`, {
          body: { approvalId },
        }),
    ),
    makeTool(
      "paperclipUnlinkIssueApproval",
      "Unlink an approval from an issue",
      z.object({ issueId: issueIdSchema, approvalId: approvalIdSchema }),
      async ({ issueId, approvalId }) =>
        client.requestJson(
          "DELETE",
          `/issues/${encodeURIComponent(issueId)}/approvals/${encodeURIComponent(approvalId)}`,
        ),
    ),
    makeTool(
      "paperclipApprovalDecision",
      "Approve, reject, request revision, or resubmit an approval",
      approvalDecisionSchema,
      async ({ approvalId, action, decisionNote, payloadJson }) => {
        const path =
          action === "approve"
            ? `/approvals/${encodeURIComponent(approvalId)}/approve`
            : action === "reject"
              ? `/approvals/${encodeURIComponent(approvalId)}/reject`
              : action === "requestRevision"
                ? `/approvals/${encodeURIComponent(approvalId)}/request-revision`
                : `/approvals/${encodeURIComponent(approvalId)}/resubmit`;

        const body =
          action === "resubmit"
            ? { payload: parseOptionalJson(payloadJson) ?? {} }
            : { decisionNote };

        return client.requestJson("POST", path, { body });
      },
    ),
    makeTool(
      "paperclipAddApprovalComment",
      "Add a comment to an approval",
      z.object({ approvalId: approvalIdSchema, body: z.string().min(1) }),
      async ({ approvalId, body }) =>
        client.requestJson("POST", `/approvals/${encodeURIComponent(approvalId)}/comments`, {
          body: { body },
        }),
    ),
    makeTool(
      "paperclipReleaseStaleExecutionLock",
      "Release the execution lock on an issue when its referenced run is terminal or missing. Safe recovery path — does nothing if the lock is still active.",
      z.object({ issueId: issueIdSchema }),
      async ({ issueId }) =>
        client.requestJson(
          "POST",
          `/issues/${encodeURIComponent(issueId)}/execution-lock/release-stale`,
          { body: {} },
        ),
    ),
    makeTool(
      "paperclipForceReleaseExecutionLock",
      "Board-only admin force-release of an issue's execution lock, including when the backing run is still active. Requires a reason, which is recorded in the activity log.",
      forceReleaseExecutionLockSchema,
      async ({ issueId, reason }) =>
        client.requestJson(
          "POST",
          `/issues/${encodeURIComponent(issueId)}/execution-lock/force-release`,
          { body: { reason } },
        ),
    ),
    makeTool(
      "paperclipListAgentHires",
      "List pending or resolved agent-hire approvals for a company.",
      z.object({ companyId: companyIdOptional, status: z.string().optional() }),
      async ({ companyId, status }) => {
        const params = new URLSearchParams();
        params.set("type", "hire_agent");
        if (status) params.set("status", status);
        return client.requestJson(
          "GET",
          `/companies/${client.resolveCompanyId(companyId)}/approvals?${params.toString()}`,
        );
      },
    ),
    makeTool(
      "paperclipCreateAgentHire",
      "Submit an agent-hire request (same payload shape as the paperclip-create-agent skill). The server may auto-create a board approval if the company requires it.",
      createAgentHireToolSchema,
      async ({ companyId, ...body }) =>
        client.requestJson(
          "POST",
          `/companies/${client.resolveCompanyId(companyId)}/agent-hires`,
          { body },
        ),
    ),
    makeTool(
      "paperclipGetCompanySettings",
      "Read company-level settings and status (requireBoardApprovalForNewAgents, codexSandboxLoopbackEnabled, feedbackDataSharingEnabled, pauseReason, budget, etc.).",
      z.object({ companyId: companyIdOptional }),
      async ({ companyId }) => client.requestJson("GET", `/companies/${client.resolveCompanyId(companyId)}`),
    ),
    makeTool(
      "paperclipUpdateCompanySettings",
      "Update company-level settings (board toggles, status, budgets, branding pointers). Only the fields you pass are patched; all are optional.",
      updateCompanySettingsToolSchema,
      async ({ companyId, ...body }) =>
        client.requestJson("PATCH", `/companies/${client.resolveCompanyId(companyId)}`, { body }),
    ),
    makeTool(
      "paperclipListRoutines",
      "List routines (scheduled / webhook-triggered automations) for a company.",
      z.object({ companyId: companyIdOptional }),
      async ({ companyId }) =>
        client.requestJson("GET", `/companies/${client.resolveCompanyId(companyId)}/routines`),
    ),
    makeTool(
      "paperclipGetRoutine",
      "Get a routine with its triggers by id.",
      z.object({ routineId: z.string().uuid() }),
      async ({ routineId }) => client.requestJson("GET", `/routines/${encodeURIComponent(routineId)}`),
    ),
    makeTool(
      "paperclipListCompanySkills",
      "List the skills installed in a company's skill library.",
      z.object({ companyId: companyIdOptional }),
      async ({ companyId }) =>
        client.requestJson("GET", `/companies/${client.resolveCompanyId(companyId)}/skills`),
    ),
    makeTool(
      "paperclipPreviewCompanyImport",
      "Preview a company portability import without applying it. Returns the proposed agent/project/issue actions and any collision warnings. Supports allowNewAgents to bypass the approval gate when importing into a company with requireBoardApprovalForNewAgents.",
      previewCompanyImportToolSchema,
      async ({ companyId, ...body }) =>
        client.requestJson(
          "POST",
          `/companies/${client.resolveCompanyId(companyId)}/imports/preview`,
          { body },
        ),
    ),
    makeTool(
      "paperclipDiagnoseIssue",
      "One-call diagnostic for an issue: status, executionLock age + stale flag, executionState (current stage/participant), blockers with their statuses, last 3 comments, and a suggestedAction when the issue is recoverably stuck.",
      diagnoseIssueSchema,
      async ({ issueId }) => {
        const now = Date.now();
        const issue = await client.requestJson<Record<string, unknown>>(
          "GET",
          `/issues/${encodeURIComponent(issueId)}`,
        );
        const executionRunId =
          typeof issue.executionRunId === "string" ? issue.executionRunId : null;
        const blockedByIds = Array.isArray(issue.blockedByIssueIds)
          ? (issue.blockedByIssueIds as string[])
          : [];

        const [commentsRaw, runRaw, blockers] = await Promise.all([
          safeGet<unknown>(
            client,
            `/issues/${encodeURIComponent(issueId)}/comments?order=desc&limit=3`,
          ),
          executionRunId
            ? safeGet<Record<string, unknown>>(
                client,
                `/heartbeat-runs/${encodeURIComponent(executionRunId)}`,
              )
            : Promise.resolve(null),
          Promise.all(
            blockedByIds.map(async (id) => {
              const b = await safeGet<Record<string, unknown>>(
                client,
                `/issues/${encodeURIComponent(id)}`,
              );
              return b
                ? { id, identifier: b.identifier, status: b.status, title: b.title }
                : { id, error: "could not load" };
            }),
          ),
        ]);

        const runStatus = typeof runRaw?.status === "string" ? (runRaw.status as string) : null;
        const lockAgeMs = ageMs(
          typeof issue.executionLockedAt === "string" ? issue.executionLockedAt : null,
          now,
        );
        const staleLock =
          !!executionRunId &&
          (runRaw === null || (runStatus !== null && TERMINAL_RUN_STATUSES.has(runStatus)));

        let suggestedAction: string | null = null;
        if (staleLock) {
          suggestedAction =
            "Call paperclipReleaseStaleExecutionLock to clear the stale execution lock, then reassign or checkout the issue.";
        } else if (blockers.some((b) => b.status && b.status !== "done" && b.status !== "cancelled")) {
          suggestedAction = "Issue is blocked by open dependencies. Unblock those first.";
        }

        return {
          issue: {
            id: issue.id,
            identifier: issue.identifier,
            status: issue.status,
            assigneeAgentId: issue.assigneeAgentId,
            assigneeUserId: issue.assigneeUserId,
            executionRunId,
            executionLockedAt: issue.executionLockedAt,
            executionLockAgeMs: lockAgeMs,
            executionState: issue.executionState,
            executionPolicy: issue.executionPolicy,
            blockedByIssueIds: blockedByIds,
          },
          currentRun: runRaw
            ? {
                id: runRaw.id,
                status: runStatus,
                startedAt: runRaw.startedAt,
                finishedAt: runRaw.finishedAt,
                error: runRaw.error,
                errorCode: runRaw.errorCode,
              }
            : null,
          staleLock,
          blockers,
          recentComments: commentsRaw,
          suggestedAction,
        };
      },
    ),
    makeTool(
      "paperclipDiagnoseAgent",
      "One-call diagnostic for an agent: status, pauseReason, lastHeartbeatAt age, recent runs with their statuses, open hire approval (if any), and the issues currently locked to this agent.",
      diagnoseAgentSchema,
      async ({ agentId, recentRunLimit }) => {
        const now = Date.now();
        const agent = await client.requestJson<Record<string, unknown>>(
          "GET",
          `/agents/${encodeURIComponent(agentId)}`,
        );
        const companyId =
          typeof agent.companyId === "string" ? (agent.companyId as string) : null;

        const recentRunsParams = new URLSearchParams();
        if (companyId) recentRunsParams.set("companyId", companyId);
        recentRunsParams.set("agentId", String(agent.id));
        recentRunsParams.set("limit", String(recentRunLimit));

        const [recentRunsRaw, lockedIssuesRaw, hiresRaw] = await Promise.all([
          companyId
            ? safeGet<unknown>(
                client,
                `/companies/${companyId}/heartbeat-runs?${recentRunsParams.toString()}`,
              )
            : Promise.resolve(null),
          companyId
            ? safeGet<unknown>(
                client,
                `/companies/${companyId}/issues?assigneeAgentId=${encodeURIComponent(String(agent.id))}&status=in_progress`,
              )
            : Promise.resolve(null),
          companyId
            ? safeGet<unknown>(
                client,
                `/companies/${companyId}/approvals?type=hire_agent&status=pending`,
              )
            : Promise.resolve(null),
        ]);

        const recentRuns = Array.isArray(recentRunsRaw)
          ? (recentRunsRaw as Array<Record<string, unknown>>)
          : [];
        const failedRuns = recentRuns.filter(
          (r) => r.status === "failed" || r.status === "timed_out",
        );

        const lockedIssues = Array.isArray(lockedIssuesRaw)
          ? (lockedIssuesRaw as Array<Record<string, unknown>>).filter(
              (i) => typeof i.executionRunId === "string",
            )
          : [];

        const openHireApprovals = Array.isArray(hiresRaw)
          ? (hiresRaw as Array<Record<string, unknown>>).filter((a) => {
              const payload = (a.payload ?? {}) as Record<string, unknown>;
              return payload.agentId === agent.id;
            })
          : [];

        return {
          agent: {
            id: agent.id,
            name: agent.name,
            role: agent.role,
            status: agent.status,
            adapterType: agent.adapterType,
            pauseReason: agent.pauseReason,
            lastHeartbeatAt: agent.lastHeartbeatAt,
            lastHeartbeatAgeMs: ageMs(
              typeof agent.lastHeartbeatAt === "string" ? agent.lastHeartbeatAt : null,
              now,
            ),
            budgetMonthlyCents: agent.budgetMonthlyCents,
            spentMonthlyCents: agent.spentMonthlyCents,
          },
          recentRuns: recentRuns.slice(0, recentRunLimit),
          recentFailedRunCount: failedRuns.length,
          lockedIssues: lockedIssues.map((i) => ({
            id: i.id,
            identifier: i.identifier,
            status: i.status,
            executionRunId: i.executionRunId,
            executionLockedAt: i.executionLockedAt,
          })),
          openHireApprovals,
        };
      },
    ),
    makeTool(
      "paperclipDiagnoseCompany",
      "Top-level one-call diagnostic: paused or over-budget agents, issues with potentially stale execution locks, pending approvals older than approvalAgeWarnHours, routines with missed/overdue next-fire windows, and top-level company pause status.",
      diagnoseCompanySchema,
      async ({ companyId, approvalAgeWarnHours }) =>
        diagnoseCompany(client, { companyId, approvalAgeWarnHours }),
    ),
    makeTool(
      "paperclipApiRequest",
      "Make a JSON request to an existing Paperclip /api endpoint for unsupported operations",
      apiRequestSchema,
      async ({ method, path, jsonBody }) => {
        if (!path.startsWith("/") || path.includes("..")) {
          throw new Error("path must start with / and be relative to /api, and must not contain '..'");
        }
        return client.requestJson(method, path, {
          body: parseOptionalJson(jsonBody),
        });
      },
    ),
  ];
}
