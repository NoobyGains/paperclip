import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { discoverProjects } from "./portfolio-discovery.js";
import {
  getHiringProfile,
  listHiringProfiles,
  type HiringProfileId,
} from "./hiring-profiles.js";
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
  updateUserProfileSchema,
} from "@paperclipai/shared";
import { PaperclipApiClient } from "./client.js";
import {
  TERMINAL_RUN_STATUSES,
  ageMs,
  diagnoseCompany,
  safeGet,
} from "./diagnostics.js";
import { formatErrorResponse, formatTextResponse } from "./format.js";

/**
 * MCP tool annotations (hints only, not guarantees). See the MCP spec on
 * ToolAnnotations: readOnlyHint, destructiveHint, idempotentHint,
 * openWorldHint. Clients use these to decide whether to prompt the user
 * before invoking a tool. `title` is a short human-readable label.
 */
export interface PaperclipToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  schema: z.AnyZodObject;
  annotations?: PaperclipToolAnnotations;
  execute: (input: Record<string, unknown>) => Promise<{
    content: Array<{ type: "text"; text: string }>;
    isError?: boolean;
  }>;
}

function makeTool<TSchema extends z.ZodRawShape>(
  name: string,
  description: string,
  schema: z.ZodObject<TSchema>,
  execute: (input: z.infer<typeof schema>) => Promise<unknown>,
  annotations?: PaperclipToolAnnotations,
): ToolDefinition {
  return {
    name,
    description,
    schema,
    annotations,
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

// Paperclip is treated as the user's own trusted data plane (not a random
// external service), so openWorldHint is false across the surface unless
// the tool is the escape-hatch paperclipApiRequest.
const READ_ONLY: PaperclipToolAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  destructiveHint: false,
  openWorldHint: false,
};
const SAFE_WRITE: PaperclipToolAnnotations = {
  readOnlyHint: false,
  idempotentHint: false,
  destructiveHint: false,
  openWorldHint: false,
};
const IDEMPOTENT_UPDATE: PaperclipToolAnnotations = {
  readOnlyHint: false,
  idempotentHint: true,
  destructiveHint: false,
  openWorldHint: false,
};
const DESTRUCTIVE: PaperclipToolAnnotations = {
  readOnlyHint: false,
  idempotentHint: false,
  destructiveHint: true,
  openWorldHint: false,
};

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

const bootstrapAppSchema = z.object({
  name: z.string().min(1).max(120),
  repoPath: z.string().min(1).max(1024),
  ceoAdapterType: z.string().min(1).max(64).optional().default("claude_local"),
  writeProjectConfig: z.boolean().optional().default(true),
});


/**
 * Annotations are attached centrally at the end of createToolDefinitions
 * so each makeTool call stays terse. Keys must match tool names exactly.
 */
const TOOL_ANNOTATIONS: Record<string, PaperclipToolAnnotations> = {
  // Read-only / diagnostic tools
  paperclipMe: { ...READ_ONLY, title: "Current actor" },
  paperclipGetMyProfile: { ...READ_ONLY, title: "Operator profile" },
  paperclipUpdateMyProfile: { ...SAFE_WRITE, title: "Update operator profile" },
  paperclipInboxLite: { ...READ_ONLY, title: "Agent inbox (lite)" },
  paperclipListAgents: { ...READ_ONLY, title: "List agents" },
  paperclipGetAgent: { ...READ_ONLY, title: "Get agent" },
  paperclipListIssues: { ...READ_ONLY, title: "List issues" },
  paperclipGetIssue: { ...READ_ONLY, title: "Get issue" },
  paperclipGetHeartbeatContext: { ...READ_ONLY, title: "Heartbeat context" },
  paperclipListComments: { ...READ_ONLY, title: "List comments" },
  paperclipGetComment: { ...READ_ONLY, title: "Get comment" },
  paperclipListIssueApprovals: { ...READ_ONLY, title: "List issue approvals" },
  paperclipListDocuments: { ...READ_ONLY, title: "List issue documents" },
  paperclipGetDocument: { ...READ_ONLY, title: "Get issue document" },
  paperclipListDocumentRevisions: { ...READ_ONLY, title: "List document revisions" },
  paperclipListProjects: { ...READ_ONLY, title: "List projects" },
  paperclipGetProject: { ...READ_ONLY, title: "Get project" },
  paperclipListGoals: { ...READ_ONLY, title: "List goals" },
  paperclipGetGoal: { ...READ_ONLY, title: "Get goal" },
  paperclipListApprovals: { ...READ_ONLY, title: "List approvals" },
  paperclipGetApproval: { ...READ_ONLY, title: "Get approval" },
  paperclipGetApprovalIssues: { ...READ_ONLY, title: "Approval issues" },
  paperclipListApprovalComments: { ...READ_ONLY, title: "List approval comments" },
  paperclipListAgentHires: { ...READ_ONLY, title: "List agent hires" },
  paperclipGetCompanySettings: { ...READ_ONLY, title: "Company settings" },
  paperclipListRoutines: { ...READ_ONLY, title: "List routines" },
  paperclipGetRoutine: { ...READ_ONLY, title: "Get routine" },
  paperclipListCompanySkills: { ...READ_ONLY, title: "List company skills" },
  paperclipPreviewCompanyImport: { ...READ_ONLY, title: "Preview company import" },
  paperclipDiagnoseIssue: { ...READ_ONLY, title: "Diagnose issue" },
  paperclipDiagnoseAgent: { ...READ_ONLY, title: "Diagnose agent" },
  paperclipDiagnoseCompany: { ...READ_ONLY, title: "Diagnose company" },
  paperclipSetup: { ...READ_ONLY, title: "MCP setup validator" },
  paperclipGetAdapterModels: { ...READ_ONLY, title: "Adapter model list" },
  paperclipGetAdapterConfigSchema: { ...READ_ONLY, title: "Adapter config schema" },
  paperclipListHiringProfiles: { ...READ_ONLY, title: "List hiring profiles" },
  paperclipHireWithProfile: { ...SAFE_WRITE, title: "Hire with profile" },
  paperclipBootstrapApp: {
    ...SAFE_WRITE,
    title: "Bootstrap a paperclip app",
    // Creates a new company — that's additive, not destructive. But it
    // also writes to the local filesystem when writeProjectConfig=true,
    // so we hint destructiveHint=false since the write is scoped to the
    // repo the user pointed at. The openWorldHint stays false because
    // paperclip itself is the same-trust-zone data plane.
  },

  // Safe writes (create new data, do not overwrite existing)
  paperclipCreateIssue: { ...SAFE_WRITE, title: "Create issue" },
  paperclipAddComment: { ...SAFE_WRITE, title: "Add issue comment" },
  paperclipCreateApproval: { ...SAFE_WRITE, title: "Create approval" },
  paperclipAddApprovalComment: { ...SAFE_WRITE, title: "Add approval comment" },
  paperclipCreateAgentHire: { ...SAFE_WRITE, title: "Hire agent" },

  // Idempotent updates (can be retried safely)
  paperclipUpdateIssue: { ...IDEMPOTENT_UPDATE, title: "Update issue" },
  paperclipUpsertIssueDocument: { ...IDEMPOTENT_UPDATE, title: "Upsert issue document" },
  paperclipCheckoutIssue: { ...IDEMPOTENT_UPDATE, title: "Checkout issue" },
  paperclipReleaseIssue: { ...IDEMPOTENT_UPDATE, title: "Release issue" },
  paperclipUpdateCompanySettings: { ...IDEMPOTENT_UPDATE, title: "Update company settings" },
  paperclipReleaseStaleExecutionLock: {
    ...IDEMPOTENT_UPDATE,
    title: "Release stale execution lock",
  },
  paperclipApprovalDecision: { ...IDEMPOTENT_UPDATE, title: "Approval decision" },
  paperclipLinkIssueApproval: { ...IDEMPOTENT_UPDATE, title: "Link issue approval" },
  paperclipRestoreIssueDocumentRevision: {
    ...IDEMPOTENT_UPDATE,
    title: "Restore document revision",
  },

  // Destructive (override/remove something)
  paperclipForceReleaseExecutionLock: {
    ...DESTRUCTIVE,
    title: "Force-release execution lock",
  },
  paperclipUnlinkIssueApproval: { ...DESTRUCTIVE, title: "Unlink issue approval" },

  // The generic escape hatch talks to an arbitrary path — annotations
  // can't be determined. Mark openWorldHint true to encourage the client
  // to prompt the user before using it.
  paperclipApiRequest: { openWorldHint: true, title: "Raw API request" },

  // Portfolio discovery — reads local FS and optionally GitHub. No writes.
  paperclipDiscoverProjects: {
    ...READ_ONLY,
    openWorldHint: true, // may reach GitHub API
    title: "Discover portfolio projects",
  },
};

export function createToolDefinitions(client: PaperclipApiClient): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    makeTool(
      "paperclipMe",
      "Get the current authenticated Paperclip actor details",
      z.object({}),
      async () => client.requestJson("GET", "/agents/me"),
    ),
    makeTool(
      "paperclipGetMyProfile",
      "Return the operator's profile (subscription declarations + preferences). Every caller operating as a board user has one — auto-created with safe defaults (subscriptionOnly=true) on first access.",
      z.object({}),
      async () => client.getMyProfile(),
    ),
    makeTool(
      "paperclipUpdateMyProfile",
      "Update the operator's profile. Pass any subset of { subscriptionOnly, claudeSubscription, codexSubscription, preferences }. Subscription plans: max, pro, plus, api, none. Set a subscription field to null to clear it.",
      updateUserProfileSchema,
      async (input) => client.updateMyProfile(input),
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
      "paperclipListHiringProfiles",
      "List the CEO hiring profiles (coding-heavy, coding-standard, coding-light, reasoning-heavy, reasoning-standard, reviewer, research). Each entry has the full expanded adapterType + adapterConfig + capabilities. Read this before picking a profile for a hire.",
      z.object({}),
      async () => listHiringProfiles(),
    ),
    makeTool(
      "paperclipHireWithProfile",
      "Hire a new agent using one of the CEO hiring profiles. Expands the profile into the full adapterType + adapterConfig + capabilities client-side, then POSTs to /api/companies/:id/agent-hires. Use this as your default hire path — it's shorter than paperclipCreateAgentHire and ensures the CEO's profile decisions are applied consistently.",
      z.object({
        name: z.string().min(1).max(120),
        role: z.string().min(1).max(64),
        title: z.string().max(200).nullable().optional(),
        icon: z.string().max(60).nullable().optional(),
        reportsTo: z.string().uuid().nullable().optional(),
        capabilities: z.string().max(1000).optional(),
        desiredSkills: z.array(z.string().min(1)).optional(),
        profile: z.enum([
          "coding-heavy",
          "coding-standard",
          "coding-light",
          "reasoning-heavy",
          "reasoning-standard",
          "reviewer",
          "research",
        ]),
        adapterConfigOverride: z.record(z.unknown()).optional(),
        companyId: companyIdOptional,
        sourceIssueId: z.string().uuid().optional().nullable(),
      }),
      async (input) => {
        const profile = getHiringProfile(input.profile as HiringProfileId);
        if (!profile) {
          throw new Error(`unknown hiring profile: ${input.profile}`);
        }
        const mergedAdapterConfig = {
          ...profile.adapterConfig,
          ...(input.adapterConfigOverride ?? {}),
        };
        const body: Record<string, unknown> = {
          name: input.name,
          role: input.role,
          adapterType: profile.adapterType,
          adapterConfig: mergedAdapterConfig,
          // Capabilities flag is still in-flight on the server (issue #14 L3).
          // Until the server accepts it natively, we translate webSearch=true
          // into the codex `search: true` adapter-config key here so the
          // profile produces the right adapter behavior end-to-end today.
        };
        if (input.title !== undefined) body.title = input.title;
        if (input.icon !== undefined) body.icon = input.icon;
        if (input.reportsTo !== undefined) body.reportsTo = input.reportsTo;
        if (input.capabilities !== undefined) body.capabilities = input.capabilities;
        if (input.desiredSkills !== undefined) body.desiredSkills = input.desiredSkills;
        if (input.sourceIssueId !== undefined) body.sourceIssueId = input.sourceIssueId;

        // Until the server L3 capabilities translator ships, translate
        // webSearch on codex_local into adapterConfig.search=true client-side
        // so the effect is visible end-to-end.
        if (profile.capabilities.webSearch && profile.adapterType === "codex_local") {
          (body.adapterConfig as Record<string, unknown>).search = true;
        }

        return client.requestJson(
          "POST",
          `/companies/${client.resolveCompanyId(input.companyId)}/agent-hires`,
          { body },
        );
      },
    ),
    makeTool(
      "paperclipGetAdapterModels",
      "Get the enriched model list for a specific adapter type (e.g. codex_local, claude_local). Each model entry includes tier (mini/standard/thinking/fast), recommendedFor (simple/coding/reasoning/research/review), contextWindow, and notes. Use this when picking a model for a hire.",
      z.object({
        adapterType: z.string().min(1).max(64),
        companyId: companyIdOptional,
      }),
      async ({ adapterType, companyId }) =>
        client.requestJson(
          "GET",
          `/companies/${client.resolveCompanyId(companyId)}/adapters/${encodeURIComponent(adapterType)}/models`,
        ),
    ),
    makeTool(
      "paperclipGetAdapterConfigSchema",
      "Get the Zod-derived config schema for a specific adapter type. Returns the structured shape of the adapterConfig field so the operator-LLM knows what options exist (model, effort, search, sandbox, etc.) without having to guess from documentation.",
      z.object({ adapterType: z.string().min(1).max(64) }),
      async ({ adapterType }) =>
        client.requestJson(
          "GET",
          `/adapters/${encodeURIComponent(adapterType)}/config-schema`,
        ),
    ),
    makeTool(
      "paperclipBootstrapApp",
      "One-call app onboarding. Creates a new company, turns on auto-hire (so the CEO can hire specialists without approval), directly hires a CEO agent on the chosen adapter, creates a project pointing at repoPath, and optionally writes a .paperclip/project.yaml inside the repo so future sessions pick up the IDs. Requires a board-level API key.",
      bootstrapAppSchema,
      async ({ name, repoPath, ceoAdapterType, writeProjectConfig }) => {
        const trimmedRepoPath = repoPath.trim();
        const absoluteRepoPath = path.isAbsolute(trimmedRepoPath)
          ? trimmedRepoPath
          : path.resolve(process.cwd(), trimmedRepoPath);

        // 1. Create the company.
        const company = await client.requestJson<Record<string, unknown>>(
          "POST",
          "/companies",
          { body: { name: `${name} workspace` } },
        );
        const companyId = String(company.id);

        // 2. Turn on auto-hire and disable the board-approval gate so the
        //    CEO can spawn specialists without manual approval.
        const updatedCompany = await client.requestJson<Record<string, unknown>>(
          "PATCH",
          `/companies/${companyId}`,
          {
            body: {
              requireBoardApprovalForNewAgents: false,
              autoHireEnabled: true,
            },
          },
        );

        // 3. Create the CEO agent directly (bypasses the approval flow via
        //    the board-only direct-create endpoint).
        const ceo = await client.requestJson<Record<string, unknown>>(
          "POST",
          `/companies/${companyId}/agents`,
          {
            body: {
              name: "CEO",
              role: "ceo",
              title: "Chief Executive Officer",
              icon: "crown",
              adapterType: ceoAdapterType,
              adapterConfig: { cwd: absoluteRepoPath },
              runtimeConfig: {
                heartbeat: { enabled: false, wakeOnDemand: true },
              },
              permissions: { canCreateAgents: true },
              capabilities:
                "Owns strategy, prioritization, delegation, and hiring for this company.",
            },
          },
        );

        // 4. Create the project pointing at the repo so issues can land.
        const project = await client.requestJson<Record<string, unknown>>(
          "POST",
          `/companies/${companyId}/projects`,
          {
            body: {
              name,
              description: `Autoboostrapped project for ${name}`,
              workspace: {
                cwd: absoluteRepoPath,
                sourceType: "local_path",
                isPrimary: true,
              },
            },
          },
        );

        // 5. Optionally persist a .paperclip/project.yaml so future MCP
        //    sessions started inside the repo pick the IDs up automatically.
        let configFilePath: string | null = null;
        let configWriteError: string | null = null;
        if (writeProjectConfig) {
          const dotDir = path.join(absoluteRepoPath, ".paperclip");
          configFilePath = path.join(dotDir, "project.yaml");
          try {
            await fs.mkdir(dotDir, { recursive: true });
            const yaml = [
              "# Paperclip project pointer — auto-generated by paperclipBootstrapApp",
              `# on ${new Date().toISOString()}`,
              `companyId: ${companyId}`,
              `projectId: ${String(project.id)}`,
              `ceoAgentId: ${String(ceo.id)}`,
              `paperclipApiUrl: ${(client as unknown as { config: { apiUrl: string } }).config.apiUrl.replace(/\/api$/, "")}`,
              "",
            ].join("\n");
            await fs.writeFile(configFilePath, yaml, "utf8");
          } catch (error) {
            configWriteError =
              error instanceof Error ? error.message : String(error);
          }
        }

        return {
          status: configWriteError ? "created_with_warnings" : "created",
          company: {
            id: companyId,
            name: updatedCompany.name,
            autoHireEnabled: updatedCompany.autoHireEnabled,
            requireBoardApprovalForNewAgents:
              updatedCompany.requireBoardApprovalForNewAgents,
          },
          ceo: {
            id: ceo.id,
            name: ceo.name,
            adapterType: ceo.adapterType,
          },
          project: {
            id: project.id,
            name: project.name,
            workspace: project.workspace ?? null,
          },
          projectConfig: configFilePath
            ? {
                path: configFilePath,
                written: !configWriteError,
                error: configWriteError,
              }
            : null,
          nextSteps: [
            configFilePath && !configWriteError
              ? `The repo now contains ${configFilePath}. Future Claude Code sessions opened inside the repo can read it to pick up IDs without env vars.`
              : "Consider writing your own .paperclip/project.yaml to the repo if you want future sessions to bootstrap without explicit IDs.",
            "Create your first issue with paperclipCreateIssue. The CEO will triage and auto-hire specialists as needed.",
            "Check progress at any time with paperclipDiagnoseCompany.",
          ],
        };
      },
    ),
    makeTool(
      "paperclipSetup",
      "Validate the current MCP configuration and emit a ready-to-paste .mcp.json snippet. Pings /health, resolves identity via /api/agents/me, and compares the server's feature manifest with this MCP package's expectations. Call this first when the board user says 'help me set paperclip up'.",
      z.object({
        mcpServerName: z.string().min(1).max(80).optional().default("paperclip"),
      }),
      async ({ mcpServerName }) => {
        const healthRaw = await safeGet<Record<string, unknown>>(client, "/health");
        const identityRaw = await safeGet<Record<string, unknown>>(client, "/agents/me");
        const manifestRaw = await safeGet<Record<string, unknown>>(client, "/mcp/manifest");

        const defaults = client.defaults;
        const identityCompanyId =
          identityRaw && typeof identityRaw.companyId === "string"
            ? (identityRaw.companyId as string)
            : null;
        const identityAgentId =
          identityRaw && typeof identityRaw.id === "string"
            ? (identityRaw.id as string)
            : null;

        const issues: string[] = [];
        if (!healthRaw) {
          issues.push(
            "Could not reach the Paperclip server on /health. Check PAPERCLIP_API_URL and that the server is running.",
          );
        }
        if (!identityRaw) {
          issues.push(
            "Could not authenticate as an agent on /api/agents/me. Check PAPERCLIP_API_KEY.",
          );
        }
        if (!manifestRaw) {
          issues.push(
            "Server did not expose /api/mcp/manifest. This paperclip build may predate MCP manifest support; MCP tools still work, but drift cannot be detected.",
          );
        }

        const effectiveCompanyId = defaults.companyId ?? identityCompanyId;
        const effectiveAgentId = defaults.agentId ?? identityAgentId;
        if (!effectiveCompanyId) {
          issues.push(
            "No company id could be resolved. Set PAPERCLIP_COMPANY_ID or authenticate with an agent key that implies a company.",
          );
        }

        const mcpJsonEnv: Record<string, string> = {
          PAPERCLIP_API_URL: (client as unknown as { config: { apiUrl: string } }).config.apiUrl
            .replace(/\/api$/, ""),
          PAPERCLIP_API_KEY: "<keep from current env or paste here>",
        };
        if (effectiveCompanyId) mcpJsonEnv.PAPERCLIP_COMPANY_ID = effectiveCompanyId;
        if (effectiveAgentId) mcpJsonEnv.PAPERCLIP_AGENT_ID = effectiveAgentId;

        const mcpJsonSnippet = {
          mcpServers: {
            [mcpServerName]: {
              command: "npx",
              args: ["-y", "@paperclipai/mcp-server"],
              env: mcpJsonEnv,
            },
          },
        };

        return {
          status: issues.length === 0 ? "ready" : "needs_attention",
          issues,
          health: healthRaw,
          identity: identityRaw
            ? {
                id: identityRaw.id,
                name: identityRaw.name,
                role: identityRaw.role,
                companyId: identityCompanyId,
              }
            : null,
          manifest: manifestRaw,
          resolved: {
            companyId: effectiveCompanyId,
            agentId: effectiveAgentId,
          },
          mcpJsonSnippet,
          instructions: [
            "Copy the mcpJsonSnippet into your ~/.claude/config/.mcp.json (or the nearest ancestor) under mcpServers.",
            "Replace the PAPERCLIP_API_KEY placeholder with the actual key you used to authenticate this MCP session.",
            "Restart Claude Code (or your MCP client) so it picks up the new server.",
          ],
        };
      },
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
    makeTool(
      "paperclipDiscoverProjects",
      "Discover portfolio projects by scanning the local filesystem (one level deep under rootPath for .git directories) and optionally listing a GitHub owner's repos. Deduplicates entries by normalised git remote URL. Read-only — makes no writes to disk or GitHub. Returns { local, github, dedupedTotal }.",
      z.object({
        rootPath: z.string().optional().describe(
          "Absolute path to scan for local git repos. Defaults to the parent of the current working directory.",
        ),
        github: z
          .object({
            owner: z.string().min(1).describe("GitHub username or organisation to list repos for."),
          })
          .optional()
          .describe("When provided, also fetch repos from the GitHub API for this owner."),
      }),
      async ({ rootPath, github }) => {
        return discoverProjects({
          rootPath,
          github,
        });
      },
    ),
  ];

  // Apply central annotations. If a tool is missing from the map, ship
  // it with no annotations rather than failing — future additions can
  // backfill.
  return tools.map((tool) => ({
    ...tool,
    annotations: TOOL_ANNOTATIONS[tool.name] ?? tool.annotations,
  }));
}
