import type { Db } from "@paperclipai/db";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  agents,
  approvals,
  budgetIncidents,
  companies,
  costEvents,
  issueApprovals,
  issueComments,
  issueRelations,
  issues,
  projects,
} from "@paperclipai/db";
import {
  parseMissionFeaturesDocument,
  parseMissionValidationReportDocument,
  parseMissionValidationContractDocument,
  type Issue,
  type IssueDocument,
  type IssueOriginKind,
  type MissionDecomposedIssue,
  type MissionDecompositionResult,
  type MissionFeaturesDocument,
  type MissionFinding,
  type MissionWaiveFindingResult,
} from "@paperclipai/shared";
import { notFound, unprocessable } from "../errors.js";
import { documentService } from "./documents.js";
import { issueService } from "./issues.js";
import { logActivity } from "./activity-log.js";
import {
  queueIssueAssignmentWakeup,
  type IssueAssignmentWakeupDeps,
} from "./issue-assignment-wakeup.js";
import {
  buildMissionFindingWaiverEntry,
  isMissionValidationReportKey,
  missionFixIssueOriginId,
  parseMissionFindingWaivers,
  validationReportRoundFromKey,
} from "./mission-findings.js";

const GENERATED_ORIGIN_KIND_BY_RESULT_KIND = {
  milestone: "mission_milestone",
  feature: "mission_feature",
  validation: "mission_validation",
  fix_loop: "mission_fix_loop",
} as const satisfies Record<MissionDecomposedIssue["kind"], IssueOriginKind>;

type GeneratedIssueSpec = {
  kind: MissionDecomposedIssue["kind"];
  key: string;
  originKind: IssueOriginKind;
  originId: string;
  title: string;
  description: string;
  parentId: string;
  status: "todo" | "blocked";
  priority: "medium";
  blockedByIssueIds: string[];
};

type ActorInfo = {
  agentId?: string | null;
  userId?: string | null;
};
type MissionIssue = Pick<
  Issue,
  | "id"
  | "identifier"
  | "companyId"
  | "projectId"
  | "projectWorkspaceId"
  | "goalId"
  | "billingCode"
  | "executionWorkspaceId"
  | "executionWorkspacePreference"
  | "executionWorkspaceSettings"
>;
type GeneratedIssueRow = {
  id: string;
  identifier: string | null;
  title: string;
};
type MissionIssueRow = typeof issues.$inferSelect;
type MissionAdvanceActor = ActorInfo & {
  actorType: "agent" | "user" | "system";
  actorId: string;
  runId?: string | null;
};
type MissionAdvanceStopReason =
  | "approval_required"
  | "budget_limit"
  | "unresolved_blockers"
  | "max_validation_rounds";
export type MissionAdvanceResult = {
  issueId: string;
  action: "paused" | "woke_issues" | "noop";
  stopReason: MissionAdvanceStopReason | null;
  wokenIssueIds: string[];
  commentId: string | null;
  details: Record<string, unknown>;
};
type MissionFixCreationResult = {
  createdIssueIds: string[];
  updatedIssueIds: string[];
  skippedFindingIds: string[];
};
export type MissionAdvanceUnresolvedBlocker = {
  issueId: string;
  issueIdentifier: string | null;
  issueTitle: string;
  blockerIssueId: string;
  blockerIdentifier: string | null;
  blockerTitle: string;
  blockerStatus: string;
};

const TERMINAL_ISSUE_STATUSES = new Set(["done", "cancelled"]);
const WAKEABLE_ISSUE_STATUSES = new Set(["todo", "blocked"]);
const DEFAULT_MAX_VALIDATION_ROUNDS = 3;

function missionOriginId(missionIssueId: string, kind: MissionDecomposedIssue["kind"], key: string) {
  return `${missionIssueId}:${kind}:${key}`;
}

function issueReference(issue: Pick<Issue, "identifier" | "id">) {
  if (!issue.identifier) return `\`${issue.id}\``;
  const prefix = issue.identifier.split("-")[0] || "PAP";
  return `[${issue.identifier}](/${prefix}/issues/${issue.identifier})`;
}

function buildFeatureDescription(input: {
  mission: Pick<Issue, "id" | "identifier">;
  milestone: MissionFeaturesDocument["milestones"][number];
  feature: MissionFeaturesDocument["milestones"][number]["features"][number];
}) {
  const { mission, milestone, feature } = input;
  return [
    `Mission feature generated from ${issueReference(mission)}.`,
    "",
    `Mission key: \`${feature.id}\``,
    `Milestone: \`${milestone.id}\` ${milestone.title}`,
    `Kind: \`${feature.kind}\``,
    "",
    "Summary:",
    feature.summary,
    "",
    "Claimed validation assertions:",
    ...feature.claimed_assertion_ids.map((id) => `- \`${id}\``),
    "",
    "Acceptance criteria:",
    ...feature.acceptance_criteria.map((criterion) => `- ${criterion}`),
  ].join("\n");
}

function buildMilestoneDescription(input: {
  mission: Pick<Issue, "id" | "identifier">;
  milestone: MissionFeaturesDocument["milestones"][number];
}) {
  const { mission, milestone } = input;
  return [
    `Mission milestone generated from ${issueReference(mission)}.`,
    "",
    `Mission key: \`${milestone.id}\``,
    "",
    "Summary:",
    milestone.summary,
    "",
    "Features:",
    ...milestone.features.map((feature) => `- \`${feature.id}\` ${feature.title}`),
  ].join("\n");
}

function buildValidationDescription(input: {
  mission: Pick<Issue, "id" | "identifier">;
  milestone: MissionFeaturesDocument["milestones"][number];
}) {
  const { mission, milestone } = input;
  const assertions = [...new Set(milestone.features.flatMap((feature) => feature.claimed_assertion_ids))];
  return [
    `Mission validation gate generated from ${issueReference(mission)}.`,
    "",
    `Mission key: \`${milestone.id}:validation-round-1\``,
    `Milestone: \`${milestone.id}\` ${milestone.title}`,
    "",
    "Validate the completed milestone against the claimed assertions before any fix loop starts.",
    "",
    "Assertions in scope:",
    ...assertions.map((assertionId) => `- \`${assertionId}\``),
  ].join("\n");
}

function buildFixLoopDescription(input: {
  mission: Pick<Issue, "id" | "identifier">;
  milestone: MissionFeaturesDocument["milestones"][number];
}) {
  const { mission, milestone } = input;
  return [
    `Mission fix-loop placeholder generated from ${issueReference(mission)}.`,
    "",
    `Mission key: \`${milestone.id}:fix-loop\``,
    `Milestone: \`${milestone.id}\` ${milestone.title}`,
    "",
    "Use this placeholder to anchor fix issues created from blocking validation findings.",
  ].join("\n");
}

function buildFindingFixDescription(input: {
  mission: Pick<Issue, "id" | "identifier">;
  finding: MissionFinding;
  reportKey: string;
  round: number;
}) {
  const { mission, finding, reportKey, round } = input;
  return [
    `Mission fix issue generated from ${issueReference(mission)}.`,
    "",
    `Finding: \`${finding.id}\``,
    `Severity: \`${finding.severity}\``,
    `Validation report: \`${reportKey}\``,
    `Validation round: ${round}`,
    ...(finding.assertion_id ? [`Assertion: \`${finding.assertion_id}\``] : []),
    "",
    "Problem:",
    finding.title,
    "",
    "Expected:",
    finding.expected,
    "",
    "Actual:",
    finding.actual,
    "",
    "Evidence:",
    ...finding.evidence.map((item) => `- ${item}`),
    "",
    "Reproduction steps:",
    ...finding.repro_steps.map((step) => `- ${step}`),
    "",
    "Acceptance criteria:",
    `- Resolve \`${finding.id}\` so the affected validation assertion passes.`,
    ...(finding.recommended_fix_scope ? [`- Stay within this bounded scope: ${finding.recommended_fix_scope}`] : []),
    "- Leave implementation evidence in a comment, attachment, or work product.",
  ].join("\n");
}

function actorLabel(actor: ActorInfo) {
  if (actor.agentId) return `agent:${actor.agentId}`;
  if (actor.userId) return `user:${actor.userId}`;
  return "system";
}

function findMilestoneForAssertion(
  features: MissionFeaturesDocument | null,
  assertionId: string | null | undefined,
) {
  if (!features || !assertionId) return null;
  return (
    features.milestones.find((milestone) =>
      milestone.features.some((feature) => feature.claimed_assertion_ids.includes(assertionId)),
    ) ?? null
  );
}

function reportParseDetails(error: unknown) {
  return error && typeof error === "object" && "issues" in error
    ? { issues: (error as { issues: unknown }).issues }
    : undefined;
}

function classifyMissionIssue(issue: Pick<MissionIssueRow, "originKind" | "title">) {
  const originKind = issue.originKind.toLowerCase();
  if (originKind.startsWith("mission_")) return originKind;

  const title = issue.title.trim().toLowerCase();
  if (title.startsWith("milestone")) return "mission_milestone";
  if (title.startsWith("mission milestone")) return "mission_milestone";
  if (title.startsWith("validation")) return "mission_validation";
  if (title.startsWith("mission validation")) return "mission_validation";
  if (title.startsWith("fix")) return "mission_fix_loop";
  if (title.startsWith("mission fix")) return "mission_fix_loop";
  if (title.startsWith("feature")) return "mission_feature";
  if (title.startsWith("mission feature")) return "mission_feature";
  return "mission_issue";
}

function isPendingExecutionState(issue: MissionIssueRow) {
  const state = issue.executionState;
  return Boolean(
    state &&
      typeof state === "object" &&
      "status" in state &&
      (state as { status?: unknown }).status === "pending",
  );
}

function buildAdvanceStopComment(input: { marker: string; heading: string; bullets: string[] }) {
  return [
    `<!-- ${input.marker} -->`,
    input.heading,
    "",
    ...input.bullets.map((bullet) => `- ${bullet}`),
  ].join("\n");
}

async function findExistingMarkerComment(db: Db, issueId: string, marker: string) {
  return db
    .select({ id: issueComments.id })
    .from(issueComments)
    .where(and(eq(issueComments.issueId, issueId), sql`${issueComments.body} like ${`%${marker}%`}`))
    .limit(1)
    .then((rows) => rows[0]?.id ?? null);
}

async function addMissionCommentOnce(
  db: Db,
  issue: MissionIssueRow,
  actor: MissionAdvanceActor,
  marker: string,
  body: string,
) {
  const existingCommentId = await findExistingMarkerComment(db, issue.id, marker);
  if (existingCommentId) return existingCommentId;

  const [comment] = await db
    .insert(issueComments)
    .values({
      companyId: issue.companyId,
      issueId: issue.id,
      authorAgentId: actor.agentId ?? null,
      authorUserId: actor.userId ?? null,
      createdByRunId: actor.runId ?? null,
      body,
    })
    .returning();

  await db.update(issues).set({ updatedAt: new Date() }).where(eq(issues.id, issue.id));

  await logActivity(db, {
    companyId: issue.companyId,
    actorType: actor.actorType,
    actorId: actor.actorId,
    agentId: actor.agentId ?? null,
    runId: actor.runId ?? null,
    action: "issue.comment_added",
    entityType: "issue",
    entityId: issue.id,
    details: {
      commentId: comment.id,
      bodySnippet: comment.body.slice(0, 120),
      identifier: issue.identifier,
      issueTitle: issue.title,
      source: "mission.advance",
    },
  });

  return comment.id;
}

async function loadMissionTree(db: Db, missionIssue: MissionIssueRow) {
  const rows = await db
    .select()
    .from(issues)
    .where(and(eq(issues.companyId, missionIssue.companyId), isNull(issues.hiddenAt)));
  const byParent = new Map<string | null, MissionIssueRow[]>();
  for (const issue of rows) {
    const siblings = byParent.get(issue.parentId) ?? [];
    siblings.push(issue);
    byParent.set(issue.parentId, siblings);
  }

  const tree = [missionIssue];
  const queue = [missionIssue.id];
  const seen = new Set<string>([missionIssue.id]);
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    for (const child of byParent.get(parentId) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      tree.push(child);
      queue.push(child.id);
    }
  }
  return tree;
}

async function findPendingApprovalIssueIds(db: Db, companyId: string, issueIds: string[]) {
  if (issueIds.length === 0) return [];
  const rows = await db
    .select({ issueId: issueApprovals.issueId })
    .from(issueApprovals)
    .innerJoin(approvals, eq(issueApprovals.approvalId, approvals.id))
    .where(
      and(
        eq(issueApprovals.companyId, companyId),
        inArray(issueApprovals.issueId, issueIds),
        eq(approvals.status, "pending"),
      ),
    );
  return [...new Set(rows.map((row) => row.issueId))];
}

async function findUnresolvedBlockers(db: Db, companyId: string, issueIds: string[]) {
  if (issueIds.length === 0) return [];
  const relationRows = await db
    .select({
      blockerIssueId: issueRelations.issueId,
      blockedIssueId: issueRelations.relatedIssueId,
    })
    .from(issueRelations)
    .where(
      and(
        eq(issueRelations.companyId, companyId),
        eq(issueRelations.type, "blocks"),
        inArray(issueRelations.relatedIssueId, issueIds),
      ),
    );
  if (relationRows.length === 0) return [];

  const blockerIds = [...new Set(relationRows.map((row) => row.blockerIssueId))];
  const relatedIds = [...new Set([...issueIds, ...blockerIds])];
  const relatedIssues = await db
    .select({
      id: issues.id,
      identifier: issues.identifier,
      title: issues.title,
      status: issues.status,
    })
    .from(issues)
    .where(and(eq(issues.companyId, companyId), inArray(issues.id, relatedIds)));
  const issueById = new Map(relatedIssues.map((issue) => [issue.id, issue]));

  return relationRows
    .map((row) => ({
      blocked: issueById.get(row.blockedIssueId) ?? null,
      blocker: issueById.get(row.blockerIssueId) ?? null,
    }))
    .filter((row) => row.blocked && row.blocker)
    .filter((row) => !TERMINAL_ISSUE_STATUSES.has(row.blocked!.status))
    .filter((row) => row.blocker!.status !== "done")
    .map((row): MissionAdvanceUnresolvedBlocker => ({
      issueId: row.blocked!.id,
      issueIdentifier: row.blocked!.identifier,
      issueTitle: row.blocked!.title,
      blockerIssueId: row.blocker!.id,
      blockerIdentifier: row.blocker!.identifier,
      blockerTitle: row.blocker!.title,
      blockerStatus: row.blocker!.status,
    }));
}

async function computeMissionSpendCents(db: Db, mission: MissionIssueRow, issueIds: string[]) {
  const billingCode = mission.billingCode?.trim() || null;
  const scopeConditions = [];
  if (billingCode) scopeConditions.push(eq(costEvents.billingCode, billingCode));
  if (issueIds.length > 0) scopeConditions.push(inArray(costEvents.issueId, issueIds));
  if (scopeConditions.length === 0) return 0;

  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::double precision` })
    .from(costEvents)
    .where(and(eq(costEvents.companyId, mission.companyId), or(...scopeConditions)!));
  return Number(row?.total ?? 0);
}

async function findBudgetStop(db: Db, mission: MissionIssueRow, tree: MissionIssueRow[], budgetLimitCents?: number | null) {
  const issueIds = tree.map((issue) => issue.id);
  const spendCents = await computeMissionSpendCents(db, mission, issueIds);
  if (typeof budgetLimitCents === "number" && spendCents >= budgetLimitCents) {
    return { kind: "mission_budget_limit" as const, spendCents, budgetLimitCents };
  }

  const assigneeIds = [...new Set(tree.map((issue) => issue.assigneeAgentId).filter((id): id is string => Boolean(id)))];
  const projectIds = [...new Set(tree.map((issue) => issue.projectId).filter((id): id is string => Boolean(id)))];
  const relevantScopeKeys = new Set([
    `company:${mission.companyId}`,
    ...assigneeIds.map((id) => `agent:${id}`),
    ...projectIds.map((id) => `project:${id}`),
  ]);

  const activeIncident = await db
    .select({
      id: budgetIncidents.id,
      scopeType: budgetIncidents.scopeType,
      scopeId: budgetIncidents.scopeId,
      thresholdType: budgetIncidents.thresholdType,
      amountLimit: budgetIncidents.amountLimit,
      amountObserved: budgetIncidents.amountObserved,
    })
    .from(budgetIncidents)
    .where(and(eq(budgetIncidents.companyId, mission.companyId), eq(budgetIncidents.status, "open")))
    .then((rows) =>
      rows.find((row) => relevantScopeKeys.has(`${row.scopeType}:${row.scopeId}`) && row.thresholdType === "hard_stop") ??
      null,
    );
  if (activeIncident) {
    return {
      kind: "budget_hard_stop" as const,
      incidentId: activeIncident.id,
      scopeType: activeIncident.scopeType,
      scopeId: activeIncident.scopeId,
      amountLimit: activeIncident.amountLimit,
      amountObserved: activeIncident.amountObserved,
    };
  }

  const companyPause = await db
    .select({ status: companies.status, pauseReason: companies.pauseReason })
    .from(companies)
    .where(eq(companies.id, mission.companyId))
    .then((rows) => rows[0] ?? null);
  if (companyPause?.status === "paused" && companyPause.pauseReason === "budget") {
    return { kind: "company_budget_pause" as const, companyId: mission.companyId };
  }

  const pausedProject = projectIds.length > 0
    ? await db
      .select({ id: projects.id, name: projects.name, pauseReason: projects.pauseReason, pausedAt: projects.pausedAt })
      .from(projects)
      .where(inArray(projects.id, projectIds))
      .then((rows) => rows.find((row) => row.pausedAt && row.pauseReason === "budget") ?? null)
    : null;
  if (pausedProject) {
    return { kind: "project_budget_pause" as const, projectId: pausedProject.id, projectName: pausedProject.name };
  }

  const pausedAgent = assigneeIds.length > 0
    ? await db
      .select({ id: agents.id, name: agents.name, pauseReason: agents.pauseReason })
      .from(agents)
      .where(and(inArray(agents.id, assigneeIds), eq(agents.status, "paused")))
      .then((rows) => rows.find((row) => row.pauseReason === "budget") ?? null)
    : null;
  if (pausedAgent) {
    return { kind: "agent_budget_pause" as const, agentId: pausedAgent.id, agentName: pausedAgent.name };
  }

  return null;
}

function findMaxRoundStop(tree: MissionIssueRow[], maxValidationRounds: number) {
  const childrenByParent = new Map<string | null, MissionIssueRow[]>();
  for (const issue of tree) {
    const siblings = childrenByParent.get(issue.parentId) ?? [];
    siblings.push(issue);
    childrenByParent.set(issue.parentId, siblings);
  }

  for (const issue of tree) {
    if (classifyMissionIssue(issue) !== "mission_milestone") continue;
    if (TERMINAL_ISSUE_STATUSES.has(issue.status)) continue;
    const validationCount = (childrenByParent.get(issue.id) ?? [])
      .filter((child) => classifyMissionIssue(child) === "mission_validation")
      .filter((child) => TERMINAL_ISSUE_STATUSES.has(child.status))
      .length;
    if (validationCount >= maxValidationRounds) {
      return {
        milestoneIssueId: issue.id,
        milestoneIdentifier: issue.identifier,
        milestoneTitle: issue.title,
        validationRounds: validationCount,
        maxValidationRounds,
      };
    }
  }
  return null;
}

export function chooseMissionAdvanceStop(input: {
  pendingApprovalIssueIds: string[];
  budgetStop: unknown | null;
  maxRoundStop: unknown | null;
  unresolvedBlockers: MissionAdvanceUnresolvedBlocker[];
  wakeableIssueCount?: number;
}): { reason: MissionAdvanceStopReason; details: Record<string, unknown> } | null {
  if (input.pendingApprovalIssueIds.length > 0) {
    return { reason: "approval_required", details: { pendingApprovalIssueIds: input.pendingApprovalIssueIds } };
  }
  if (input.budgetStop) return { reason: "budget_limit", details: { budgetStop: input.budgetStop } };
  if (input.maxRoundStop) return { reason: "max_validation_rounds", details: { maxRoundStop: input.maxRoundStop } };
  if (input.unresolvedBlockers.length > 0 && (input.wakeableIssueCount ?? 0) === 0) {
    return { reason: "unresolved_blockers", details: { unresolvedBlockers: input.unresolvedBlockers } };
  }
  return null;
}

export function missionService(db: Db) {
  const issuesSvc = issueService(db);
  const documentsSvc = documentService(db);

  async function findGeneratedIssue(companyId: string, originKind: IssueOriginKind, originId: string) {
    const [existing] = await issuesSvc.list(companyId, {
      originKind,
      originId,
      limit: 1,
    });
    return existing ?? null;
  }

  async function ensureGeneratedIssue(input: {
    mission: MissionIssue;
    spec: GeneratedIssueSpec;
    actor: ActorInfo;
  }) {
    const { mission, spec, actor } = input;
    const existing = await findGeneratedIssue(mission.companyId, spec.originKind, spec.originId);
    const commonFields = {
      projectId: mission.projectId,
      projectWorkspaceId: mission.projectWorkspaceId,
      goalId: mission.goalId,
      parentId: spec.parentId,
      title: spec.title,
      description: spec.description,
      priority: spec.priority,
      billingCode: mission.billingCode ?? `mission:${mission.identifier ?? mission.id}`,
      executionWorkspaceId: mission.executionWorkspaceId,
      executionWorkspacePreference: mission.executionWorkspaceId ? "reuse_existing" : mission.executionWorkspacePreference,
      executionWorkspaceSettings: mission.executionWorkspaceSettings as Record<string, unknown> | null,
      blockedByIssueIds: spec.blockedByIssueIds,
    };

    if (existing) {
      const updated = await issuesSvc.update(existing.id, {
        ...commonFields,
        actorAgentId: actor.agentId ?? null,
        actorUserId: actor.userId ?? null,
      });
      if (!updated) throw notFound("Generated mission issue disappeared during update");
      return {
        issue: updated,
        created: false,
        changedIssueId: updated.id,
      };
    }

    const created = await issuesSvc.create(mission.companyId, {
      ...commonFields,
      status: spec.status,
      originKind: spec.originKind,
      originId: spec.originId,
      inheritExecutionWorkspaceFromIssueId: mission.id,
      createdByAgentId: actor.agentId ?? null,
      createdByUserId: actor.userId ?? null,
    });
    return {
      issue: created,
      created: true,
      changedIssueId: created.id,
    };
  }

  async function readMissionDocuments(missionIssueId: string) {
    return (await documentsSvc.listIssueDocuments(missionIssueId)) as IssueDocument[];
  }

  async function ensureFixIssuesFromValidationReports(
    mission: MissionIssueRow,
    actor: ActorInfo,
  ): Promise<MissionFixCreationResult> {
    const docs = await readMissionDocuments(mission.id);
    const decisionLog = docs.find((document) => document.key === "decision-log");
    const waivers = parseMissionFindingWaivers(decisionLog?.body);
    const featuresDocument = docs.find((document) => document.key === "features") ?? null;
    let featurePlan: MissionFeaturesDocument | null = null;
    if (featuresDocument) {
      try {
        featurePlan = parseMissionFeaturesDocument(featuresDocument.body);
      } catch {
        featurePlan = null;
      }
    }

    const tree = await loadMissionTree(db, mission);
    const existingFixIssueIds = new Set<string>();
    const fixLoopByMilestoneKey = new Map<string, MissionIssueRow>();
    for (const issue of tree) {
      const findingId = /^.*:feature:fix:(FINDING-[A-Z0-9][A-Z0-9-]*-[0-9]{3,})$/.exec(issue.originId ?? "")?.[1];
      if (findingId) existingFixIssueIds.add(findingId);
      if (issue.originKind === "mission_fix_loop" && issue.originId?.startsWith(`${mission.id}:fix_loop:`)) {
        fixLoopByMilestoneKey.set(issue.originId.slice(`${mission.id}:fix_loop:`.length), issue);
      }
    }

    const createdIssueIds: string[] = [];
    const updatedIssueIds: string[] = [];
    const skippedFindingIds: string[] = [];

    for (const document of docs.filter((candidate) => isMissionValidationReportKey(candidate.key))) {
      const round = validationReportRoundFromKey(document.key) ?? undefined;
      let report: ReturnType<typeof parseMissionValidationReportDocument>;
      try {
        report = parseMissionValidationReportDocument(document.body, { round });
      } catch (error) {
        throw unprocessable(`Invalid mission validation report document: ${document.key}`, reportParseDetails(error));
      }

      for (const finding of report.findings) {
        if (finding.severity !== "blocking") continue;
        if (finding.status === "resolved" || finding.status === "waived" || waivers.has(finding.id)) {
          skippedFindingIds.push(finding.id);
          continue;
        }
        if (existingFixIssueIds.has(finding.id)) {
          skippedFindingIds.push(finding.id);
          continue;
        }

        const milestone = findMilestoneForAssertion(featurePlan, finding.assertion_id);
        const parent = milestone ? fixLoopByMilestoneKey.get(milestone.id) : null;
        const { issue, created } = await ensureGeneratedIssue({
          mission,
          actor,
          spec: {
            kind: "feature",
            key: `fix:${finding.id}`,
            originKind: "mission_feature",
            originId: missionFixIssueOriginId(mission.id, finding.id),
            title: `Mission fix: ${finding.title}`,
            description: buildFindingFixDescription({
              mission,
              finding,
              reportKey: document.key,
              round: report.round,
            }),
            parentId: parent?.id ?? mission.id,
            status: "todo",
            priority: "medium",
            blockedByIssueIds: [],
          },
        });

        if (created) createdIssueIds.push(issue.id);
        else updatedIssueIds.push(issue.id);
        existingFixIssueIds.add(finding.id);

        if (parent) {
          const relations = await issuesSvc.getRelationSummaries(parent.id);
          await issuesSvc.update(parent.id, {
            blockedByIssueIds: [...new Set([...relations.blockedBy.map((blocker) => blocker.id), issue.id])],
            actorAgentId: actor.agentId ?? null,
            actorUserId: actor.userId ?? null,
          });
        }
      }
    }

    if (createdIssueIds.length > 0 || updatedIssueIds.length > 0) {
      await logActivity(db, {
        companyId: mission.companyId,
        actorType: actor.agentId ? "agent" : actor.userId ? "user" : "system",
        actorId: actor.agentId ?? actor.userId ?? "system",
        agentId: actor.agentId ?? null,
        action: "mission.validation_fixes_created",
        entityType: "issue",
        entityId: mission.id,
        details: {
          createdIssueIds,
          updatedIssueIds,
          skippedFindingIds,
        },
      });
    }

    return {
      createdIssueIds,
      updatedIssueIds: [...new Set(updatedIssueIds.filter((id) => !createdIssueIds.includes(id)))],
      skippedFindingIds,
    };
  }

  async function findFindingInReports(missionIssueId: string, findingId: string) {
    const docs = await readMissionDocuments(missionIssueId);
    for (const document of docs.filter((candidate) => isMissionValidationReportKey(candidate.key))) {
      const round = validationReportRoundFromKey(document.key) ?? undefined;
      const report = parseMissionValidationReportDocument(document.body, { round });
      const finding = report.findings.find((candidate) => candidate.id === findingId);
      if (finding) return { finding, report, reportKey: document.key, documents: docs };
    }
    return null;
  }

  return {
    waiveFinding: async (
      issueId: string,
      input: {
        findingId: string;
        rationale: string;
        actor: ActorInfo & { runId?: string | null };
      },
    ): Promise<MissionWaiveFindingResult> => {
      const mission = await issuesSvc.getById(issueId);
      if (!mission) throw notFound("Mission issue not found");
      const located = await findFindingInReports(mission.id, input.findingId);
      if (!located) throw notFound("Mission finding not found");
      if (located.finding.severity === "blocking") {
        throw unprocessable("Blocking mission findings require a fix issue and cannot be waived here");
      }

      const decisionLog = located.documents.find((document) => document.key === "decision-log") ?? null;
      const existingWaivers = parseMissionFindingWaivers(decisionLog?.body);
      if (existingWaivers.has(input.findingId) && decisionLog) {
        return {
          missionIssueId: mission.id,
          findingId: input.findingId,
          waived: false,
          decisionLogDocumentId: decisionLog.id,
          latestRevisionId: decisionLog.latestRevisionId,
        };
      }

      const now = new Date();
      const entry = buildMissionFindingWaiverEntry({
        findingId: input.findingId,
        rationale: input.rationale,
        actorLabel: actorLabel(input.actor),
        createdAt: now,
      });
      const body = [decisionLog?.body?.trim() || "# Decision Log", "", entry].join("\n");
      const upsert = await documentsSvc.upsertIssueDocument({
        issueId: mission.id,
        key: "decision-log",
        title: "Decision Log",
        format: "markdown",
        body,
        changeSummary: `Waived ${input.findingId}`,
        baseRevisionId: decisionLog?.latestRevisionId ?? null,
        createdByAgentId: input.actor.agentId ?? null,
        createdByUserId: input.actor.userId ?? null,
        createdByRunId: input.actor.runId ?? null,
      });

      await logActivity(db, {
        companyId: mission.companyId,
        actorType: input.actor.agentId ? "agent" : input.actor.userId ? "user" : "system",
        actorId: input.actor.agentId ?? input.actor.userId ?? "system",
        agentId: input.actor.agentId ?? null,
        runId: input.actor.runId ?? null,
        action: "mission.finding_waived",
        entityType: "issue",
        entityId: mission.id,
        details: {
          findingId: input.findingId,
          reportKey: located.reportKey,
          rationale: input.rationale,
        },
      });

      return {
        missionIssueId: mission.id,
        findingId: input.findingId,
        waived: true,
        decisionLogDocumentId: upsert.document.id,
        latestRevisionId: upsert.document.latestRevisionId,
      };
    },
    decompose: async (
      issueId: string,
      input: {
        actor: ActorInfo;
        dryRun?: boolean;
      },
    ): Promise<MissionDecompositionResult> => {
      const mission = await issuesSvc.getById(issueId);
      if (!mission) throw notFound("Mission issue not found");

      const [validationDocument, featuresDocument] = await Promise.all([
        documentsSvc.getIssueDocumentByKey(mission.id, "validation-contract"),
        documentsSvc.getIssueDocumentByKey(mission.id, "features"),
      ]);
      if (!validationDocument) throw unprocessable("Mission requires a validation-contract document before decomposition");
      if (!featuresDocument) throw unprocessable("Mission requires a features document before decomposition");

      let validationContract: ReturnType<typeof parseMissionValidationContractDocument>;
      let featurePlan: ReturnType<typeof parseMissionFeaturesDocument>;
      try {
        validationContract = parseMissionValidationContractDocument(validationDocument.body ?? "");
        featurePlan = parseMissionFeaturesDocument(featuresDocument.body ?? "");
      } catch (error) {
        const details =
          error && typeof error === "object" && "issues" in error
            ? { issues: (error as { issues: unknown }).issues }
            : undefined;
        throw unprocessable("Invalid mission validation-contract or features document", details);
      }
      const assertionIds = new Set(validationContract.assertions.map((assertion) => assertion.id));
      for (const milestone of featurePlan.milestones) {
        for (const feature of milestone.features) {
          for (const assertionId of feature.claimed_assertion_ids) {
            if (!assertionIds.has(assertionId)) {
              throw unprocessable(`Feature ${feature.id} claims unknown validation assertion ${assertionId}`);
            }
          }
        }
      }

      const specs: GeneratedIssueSpec[] = [];
      const milestoneIssueIds = new Map<string, string>();
      const featureIssueIdsByMilestone = new Map<string, string[]>();
      const validationIssueIds = new Map<string, string>();

      for (const milestone of featurePlan.milestones) {
        const milestoneSpec: GeneratedIssueSpec = {
          kind: "milestone",
          key: milestone.id,
          originKind: GENERATED_ORIGIN_KIND_BY_RESULT_KIND.milestone,
          originId: missionOriginId(mission.id, "milestone", milestone.id),
          title: `Mission milestone: ${milestone.title}`,
          description: buildMilestoneDescription({ mission, milestone }),
          parentId: mission.id,
          status: "todo",
          priority: "medium",
          blockedByIssueIds: [],
        };
        specs.push(milestoneSpec);
      }

      const resultIssues: MissionDecomposedIssue[] = [];
      const createdIssueIds: string[] = [];
      const updatedIssueIds: string[] = [];

      async function record(spec: GeneratedIssueSpec, issue: GeneratedIssueRow, created: boolean) {
        resultIssues.push({
          kind: spec.kind,
          key: spec.key,
          issueId: issue.id,
          identifier: issue.identifier ?? null,
          title: issue.title,
          created,
          blockedByIssueIds: spec.blockedByIssueIds,
        });
        if (created) createdIssueIds.push(issue.id);
        else updatedIssueIds.push(issue.id);
      }

      if (input.dryRun) {
        return {
          missionIssueId: mission.id,
          milestoneCount: featurePlan.milestones.length,
          featureCount: featurePlan.milestones.reduce((count, milestone) => count + milestone.features.length, 0),
          validationCount: featurePlan.milestones.length,
          fixLoopCount: featurePlan.milestones.length,
          createdIssueIds: [],
          updatedIssueIds: [],
          issues: specs.map((spec) => ({
            kind: spec.kind,
            key: spec.key,
            issueId: "",
            identifier: null,
            title: spec.title,
            created: false,
            blockedByIssueIds: spec.blockedByIssueIds,
          })),
        };
      }

      for (const spec of specs) {
        const { issue, created } = await ensureGeneratedIssue({ mission, spec, actor: input.actor });
        milestoneIssueIds.set(spec.key, issue.id);
        await record(spec, issue, created);
      }

      for (const milestone of featurePlan.milestones) {
        const parentId = milestoneIssueIds.get(milestone.id);
        if (!parentId) throw new Error(`Missing generated milestone issue for ${milestone.id}`);
        const featureIssueIds: string[] = [];
        for (const feature of milestone.features) {
          const spec: GeneratedIssueSpec = {
            kind: "feature",
            key: feature.id,
            originKind: GENERATED_ORIGIN_KIND_BY_RESULT_KIND.feature,
            originId: missionOriginId(mission.id, "feature", feature.id),
            title: `Mission feature: ${feature.title}`,
            description: buildFeatureDescription({ mission, milestone, feature }),
            parentId,
            status: "todo",
            priority: "medium",
            blockedByIssueIds: [],
          };
          const { issue, created } = await ensureGeneratedIssue({ mission, spec, actor: input.actor });
          featureIssueIds.push(issue.id);
          await record(spec, issue, created);
        }
        featureIssueIdsByMilestone.set(milestone.id, featureIssueIds);
      }

      for (const milestone of featurePlan.milestones) {
        const parentId = milestoneIssueIds.get(milestone.id);
        if (!parentId) throw new Error(`Missing generated milestone issue for ${milestone.id}`);
        const featureIssueIds = featureIssueIdsByMilestone.get(milestone.id) ?? [];
        const spec: GeneratedIssueSpec = {
          kind: "validation",
          key: `${milestone.id}:validation-round-1`,
          originKind: GENERATED_ORIGIN_KIND_BY_RESULT_KIND.validation,
          originId: missionOriginId(mission.id, "validation", `${milestone.id}:round-1`),
          title: `Mission validation: ${milestone.title} round 1`,
          description: buildValidationDescription({ mission, milestone }),
          parentId,
          status: "blocked",
          priority: "medium",
          blockedByIssueIds: featureIssueIds,
        };
        const { issue, created } = await ensureGeneratedIssue({ mission, spec, actor: input.actor });
        validationIssueIds.set(milestone.id, issue.id);
        await record(spec, issue, created);
      }

      for (const milestone of featurePlan.milestones) {
        const parentId = milestoneIssueIds.get(milestone.id);
        const validationIssueId = validationIssueIds.get(milestone.id);
        if (!parentId || !validationIssueId) {
          throw new Error(`Missing generated milestone or validation issue for ${milestone.id}`);
        }
        const spec: GeneratedIssueSpec = {
          kind: "fix_loop",
          key: `${milestone.id}:fix-loop`,
          originKind: GENERATED_ORIGIN_KIND_BY_RESULT_KIND.fix_loop,
          originId: missionOriginId(mission.id, "fix_loop", milestone.id),
          title: `Mission fix loop: ${milestone.title}`,
          description: buildFixLoopDescription({ mission, milestone }),
          parentId,
          status: "blocked",
          priority: "medium",
          blockedByIssueIds: [validationIssueId],
        };
        const { issue, created } = await ensureGeneratedIssue({ mission, spec, actor: input.actor });
        await record(spec, issue, created);

        await ensureGeneratedIssue({
          mission,
          spec: {
            kind: "milestone",
            key: milestone.id,
            originKind: GENERATED_ORIGIN_KIND_BY_RESULT_KIND.milestone,
            originId: missionOriginId(mission.id, "milestone", milestone.id),
            title: `Mission milestone: ${milestone.title}`,
            description: buildMilestoneDescription({ mission, milestone }),
            parentId: mission.id,
            status: "blocked",
            priority: "medium",
            blockedByIssueIds: [validationIssueId, issue.id],
          },
          actor: input.actor,
        });
      }

      return {
        missionIssueId: mission.id,
        milestoneCount: featurePlan.milestones.length,
        featureCount: featurePlan.milestones.reduce((count, milestone) => count + milestone.features.length, 0),
        validationCount: featurePlan.milestones.length,
        fixLoopCount: featurePlan.milestones.length,
        createdIssueIds,
        updatedIssueIds: [...new Set(updatedIssueIds.filter((id) => !createdIssueIds.includes(id)))],
        issues: resultIssues,
      };
    },
    advance: async (
      issueId: string,
      input: {
        actor: MissionAdvanceActor;
        heartbeat: IssueAssignmentWakeupDeps;
        budgetLimitCents?: number | null;
        maxValidationRounds?: number | null;
      },
    ): Promise<MissionAdvanceResult> => {
      const mission = await db
        .select()
        .from(issues)
        .where(eq(issues.id, issueId))
        .then((rows) => rows[0] ?? null);
      if (!mission) throw notFound("Mission issue not found");

      let tree = await loadMissionTree(db, mission);
      let issueIds = tree.map((issue) => issue.id);
      const maxValidationRounds = input.maxValidationRounds ?? DEFAULT_MAX_VALIDATION_ROUNDS;
      const pendingApprovalIssueIds = [
        ...new Set([
          ...tree.filter((issue) => issue.status === "in_review" || isPendingExecutionState(issue)).map((issue) => issue.id),
          ...(await findPendingApprovalIssueIds(db, mission.companyId, issueIds)),
        ]),
      ];
      const budgetStop = await findBudgetStop(db, mission, tree, input.budgetLimitCents);
      const maxRoundStop = findMaxRoundStop(tree, maxValidationRounds);
      const stop = chooseMissionAdvanceStop({
        pendingApprovalIssueIds,
        budgetStop,
        maxRoundStop,
        unresolvedBlockers: [],
        wakeableIssueCount: 0,
      });

      if (stop?.reason === "approval_required") {
        const commentId = await addMissionCommentOnce(
          db,
          mission,
          input.actor,
          "paperclip:mission-advance:approval-stop",
          buildAdvanceStopComment({
            marker: "paperclip:mission-advance:approval-stop",
            heading: "Mission advance paused for approval",
            bullets: [
              "At least one mission issue is waiting on review or approval.",
              "The coordinator did not wake workers or validators while approval is pending.",
            ],
          }),
        );
        await logActivity(db, {
          companyId: mission.companyId,
          actorType: input.actor.actorType,
          actorId: input.actor.actorId,
          agentId: input.actor.agentId ?? null,
          runId: input.actor.runId ?? null,
          action: "mission.advance_paused",
          entityType: "issue",
          entityId: mission.id,
          details: { reason: stop.reason, ...stop.details },
        });
        return {
          issueId: mission.id,
          action: "paused",
          stopReason: stop.reason,
          wokenIssueIds: [],
          commentId,
          details: stop.details,
        };
      }

      if (stop?.reason === "budget_limit") {
        const commentId = await addMissionCommentOnce(
          db,
          mission,
          input.actor,
          "paperclip:mission-advance:budget-stop",
          buildAdvanceStopComment({
            marker: "paperclip:mission-advance:budget-stop",
            heading: "Mission advance paused by budget limits",
            bullets: [
              "The coordinator found a mission budget limit, active hard stop, or budget-paused assignee.",
              "No workers or validators were woken. Raise or resolve the budget stop before advancing again.",
            ],
          }),
        );
        await logActivity(db, {
          companyId: mission.companyId,
          actorType: input.actor.actorType,
          actorId: input.actor.actorId,
          agentId: input.actor.agentId ?? null,
          runId: input.actor.runId ?? null,
          action: "mission.advance_paused",
          entityType: "issue",
          entityId: mission.id,
          details: { reason: stop.reason, ...stop.details },
        });
        return {
          issueId: mission.id,
          action: "paused",
          stopReason: stop.reason,
          wokenIssueIds: [],
          commentId,
          details: stop.details,
        };
      }

      if (stop?.reason === "max_validation_rounds") {
        const roundStop = maxRoundStop!;
        const commentId = await addMissionCommentOnce(
          db,
          mission,
          input.actor,
          "paperclip:mission-advance:max-validation-rounds-stop",
          buildAdvanceStopComment({
            marker: "paperclip:mission-advance:max-validation-rounds-stop",
            heading: "Mission advance paused at the validation round limit",
            bullets: [
              `${issueReference({
                id: roundStop.milestoneIssueId,
                identifier: roundStop.milestoneIdentifier,
              })} has ${roundStop.validationRounds} validation rounds.`,
              "A human or orchestrator needs to decide whether to raise the limit, waive remaining risk, or stop the mission.",
            ],
          }),
        );
        await logActivity(db, {
          companyId: mission.companyId,
          actorType: input.actor.actorType,
          actorId: input.actor.actorId,
          agentId: input.actor.agentId ?? null,
          runId: input.actor.runId ?? null,
          action: "mission.advance_paused",
          entityType: "issue",
          entityId: mission.id,
          details: { reason: stop.reason, ...stop.details },
        });
        return {
          issueId: mission.id,
          action: "paused",
          stopReason: stop.reason,
          wokenIssueIds: [],
          commentId,
          details: stop.details,
        };
      }

      const fixCreation = await ensureFixIssuesFromValidationReports(mission, input.actor);
      if (fixCreation.createdIssueIds.length > 0 || fixCreation.updatedIssueIds.length > 0) {
        tree = await loadMissionTree(db, mission);
        issueIds = tree.map((issue) => issue.id);
      }

      const unresolvedBlockers = await findUnresolvedBlockers(db, mission.companyId, issueIds);
      const unresolvedBlockedIssueIds = new Set(unresolvedBlockers.map((blocker) => blocker.issueId));
      const wakeableIssues = tree.filter((issue) =>
        issue.id !== mission.id &&
        Boolean(issue.assigneeAgentId) &&
        WAKEABLE_ISSUE_STATUSES.has(issue.status) &&
        !unresolvedBlockedIssueIds.has(issue.id),
      );
      const blockerStop = chooseMissionAdvanceStop({
        pendingApprovalIssueIds: [],
        budgetStop: null,
        maxRoundStop: null,
        unresolvedBlockers,
        wakeableIssueCount: wakeableIssues.length,
      });

      if (blockerStop?.reason === "unresolved_blockers") {
        const preview = unresolvedBlockers.slice(0, 3).map((blocker) => {
          const blocked = issueReference({ id: blocker.issueId, identifier: blocker.issueIdentifier });
          const blocking = issueReference({ id: blocker.blockerIssueId, identifier: blocker.blockerIdentifier });
          return `${blocked} is waiting on ${blocking} (${blocker.blockerStatus}).`;
        });
        const commentId = await addMissionCommentOnce(
          db,
          mission,
          input.actor,
          "paperclip:mission-advance:blocker-stop",
          buildAdvanceStopComment({
            marker: "paperclip:mission-advance:blocker-stop",
            heading: "Mission advance paused on unresolved blockers",
            bullets: [
              ...preview,
              ...(unresolvedBlockers.length > preview.length
                ? [`${unresolvedBlockers.length - preview.length} more blocker relation(s) are still unresolved.`]
                : []),
            ],
          }),
        );
        await logActivity(db, {
          companyId: mission.companyId,
          actorType: input.actor.actorType,
          actorId: input.actor.actorId,
          agentId: input.actor.agentId ?? null,
          runId: input.actor.runId ?? null,
          action: "mission.advance_paused",
          entityType: "issue",
          entityId: mission.id,
          details: { reason: blockerStop.reason, ...blockerStop.details, fixCreation },
        });
        return {
          issueId: mission.id,
          action: "paused",
          stopReason: blockerStop.reason,
          wokenIssueIds: [],
          commentId,
          details: { ...blockerStop.details, fixCreation },
        };
      }

      const wokenIssueIds: string[] = [];
      for (const issue of wakeableIssues) {
        await queueIssueAssignmentWakeup({
          heartbeat: input.heartbeat,
          issue: {
            id: issue.id,
            assigneeAgentId: issue.assigneeAgentId,
            status: issue.status,
          },
          reason: issue.status === "blocked" ? "issue_blockers_resolved" : "issue_assigned",
          mutation: "mission.advance",
          contextSource: "mission.advance",
          requestedByActorType: input.actor.actorType,
          requestedByActorId: input.actor.actorId,
          rethrowOnError: true,
        });
        wokenIssueIds.push(issue.id);
      }

      await logActivity(db, {
        companyId: mission.companyId,
        actorType: input.actor.actorType,
        actorId: input.actor.actorId,
        agentId: input.actor.agentId ?? null,
        runId: input.actor.runId ?? null,
        action: "mission.advance",
        entityType: "issue",
        entityId: mission.id,
        details: {
          wokenIssueIds,
          wakeableIssueCount: wakeableIssues.length,
          fixCreation,
        },
      });

      return {
        issueId: mission.id,
        action: wokenIssueIds.length > 0 ? "woke_issues" : "noop",
        stopReason: null,
        wokenIssueIds,
        commentId: null,
        details: {
          issueCount: tree.length,
          wakeableIssueCount: wakeableIssues.length,
          fixCreation,
        },
      };
    },
  };
}
