import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { costEvents, heartbeatRuns, type Db } from "@paperclipai/db";
import {
  deriveIssueBackedMissionState,
  MISSION_REQUIRED_DOCUMENT_KEYS,
  parseMissionFeaturesDocument,
  parseMissionValidationReportDocument,
  parseMissionValidationContractDocument,
  type Issue,
  type IssueBackedMissionSummary,
  type IssueDocument,
  type IssueDocumentSummary,
  type IssueRelationIssueSummary,
  type MissionBlockedWorkItem,
  type MissionFeaturesDocument,
  type MissionFindingProjection,
  type MissionFindingSeverity,
  type MissionFindingStatus,
  type MissionMilestoneProjection,
  type MissionRequiredDocumentKey,
  type MissionSummaryIssue,
  type MissionValidationSummary,
} from "@paperclipai/shared";
import { notFound } from "../errors.js";
import { documentService } from "./documents.js";
import { issueService } from "./issues.js";
import {
  isMissionValidationReportKey,
  parseMissionFindingWaivers,
  validationReportRoundFromKey,
} from "./mission-findings.js";

const TERMINAL_ISSUE_STATUSES = new Set(["done", "cancelled"]);
const ACTIVE_RUN_STATUSES = new Set(["queued", "running"]);
const FINDING_STATUSES: MissionFindingStatus[] = ["open", "fix_created", "waived", "resolved"];

type IssueRelations = {
  blockedBy: IssueRelationIssueSummary[];
  blocks: IssueRelationIssueSummary[];
};

function isTerminalIssue(issue: Pick<Issue, "status"> | IssueRelationIssueSummary) {
  return TERMINAL_ISSUE_STATUSES.has(issue.status);
}

function missionOriginKey(missionIssueId: string, issue: Pick<Issue, "originId">, kind: string) {
  const prefix = `${missionIssueId}:${kind}:`;
  return issue.originId?.startsWith(prefix) ? issue.originId.slice(prefix.length) : null;
}

function isGeneratedFixFeature(issue: Pick<Issue, "originKind" | "originId"> | MissionSummaryIssue) {
  return issue.originKind === "mission_feature" && /:feature:fix:FINDING-[A-Z0-9][A-Z0-9-]*-[0-9]{3,}$/.test(issue.originId ?? "");
}

function validationMilestoneKey(originKey: string) {
  return originKey.replace(/:round-[1-9][0-9]*$/, "");
}

function toSummaryIssue(issue: Issue, blockedBy: IssueRelationIssueSummary[]): MissionSummaryIssue {
  return {
    id: issue.id,
    identifier: issue.identifier ?? null,
    title: issue.title,
    status: issue.status,
    priority: issue.priority,
    originKind: issue.originKind ?? "manual",
    originId: issue.originId ?? null,
    assigneeAgentId: issue.assigneeAgentId,
    assigneeUserId: issue.assigneeUserId,
    executionRunId: issue.executionRunId,
    blockedBy,
  };
}

function uniqueBlockedWork(items: MissionBlockedWorkItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.issue.id)) return false;
    seen.add(item.issue.id);
    return true;
  });
}

function documentErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Document could not be parsed.";
}

function createMilestoneProjection(input: {
  key: string;
  title: string;
  summary: string | null;
  issue: MissionSummaryIssue | null;
}): MissionMilestoneProjection {
  return {
    key: input.key,
    title: input.title,
    summary: input.summary,
    issue: input.issue,
    features: [],
    validations: [],
    fixLoops: [],
    blockers: [],
  };
}

function emptySeverityCounts(): Record<MissionFindingSeverity, number> {
  return { blocking: 0, non_blocking: 0, suggestion: 0 };
}

function emptyStatusCounts(): Record<MissionFindingStatus, number> {
  return { open: 0, fix_created: 0, waived: 0, resolved: 0 };
}

function buildValidationSummary(input: {
  mission: Issue;
  documents: IssueDocument[];
  descendants: Issue[];
  relationMap: Map<string, IssueRelations>;
  documentErrors: IssueBackedMissionSummary["documentErrors"];
}): MissionValidationSummary {
  const summaryByIssueId = new Map<string, MissionSummaryIssue>();
  for (const issue of input.descendants) {
    const relations = input.relationMap.get(issue.id);
    summaryByIssueId.set(issue.id, toSummaryIssue(issue, relations?.blockedBy ?? []));
  }

  const fixIssueByFindingId = new Map<string, MissionSummaryIssue>();
  for (const issue of input.descendants) {
    for (const findingId of /fix:(FINDING-[A-Z0-9][A-Z0-9-]*-[0-9]{3,})/.exec(issue.originId ?? "")?.slice(1) ?? []) {
      const summaryIssue = summaryByIssueId.get(issue.id);
      if (summaryIssue) fixIssueByFindingId.set(findingId, summaryIssue);
    }
  }

  const decisionLog = input.documents.find((document) => document.key === "decision-log");
  const waivers = parseMissionFindingWaivers(decisionLog?.body);
  const reports: MissionValidationSummary["reports"] = [];
  const findings: MissionFindingProjection[] = [];

  for (const document of input.documents.filter((candidate) => isMissionValidationReportKey(candidate.key))) {
    const round = validationReportRoundFromKey(document.key) ?? undefined;
    try {
      const report = parseMissionValidationReportDocument(document.body, { round });
      reports.push({
        ...report,
        documentKey: document.key,
        documentTitle: document.title ?? null,
        updatedAt: document.updatedAt ?? null,
      });
      for (const finding of report.findings) {
        const fixIssue = fixIssueByFindingId.get(finding.id) ?? null;
        const waiver = waivers.get(finding.id) ?? null;
        const computedStatus: MissionFindingStatus = waiver
          ? "waived"
          : fixIssue
            ? fixIssue.status === "done"
              ? "resolved"
              : "fix_created"
            : finding.status;
        findings.push({
          ...finding,
          sourceReportKey: document.key,
          sourceReportTitle: document.title ?? null,
          round: report.round,
          validator_role: report.validator_role,
          computedStatus,
          fixIssue,
          waiver,
        });
      }
    } catch (error) {
      input.documentErrors.push({ key: document.key, message: documentErrorMessage(error) });
    }
  }

  const bySeverity = emptySeverityCounts();
  const byStatus = emptyStatusCounts();
  const assertionMap = new Map<string, MissionValidationSummary["assertions"][number]>();
  for (const finding of findings) {
    bySeverity[finding.severity] += 1;
    byStatus[finding.computedStatus] += 1;
    if (finding.assertion_id) {
      const existing = assertionMap.get(finding.assertion_id) ?? {
        assertion_id: finding.assertion_id,
        findingIds: [],
        severity: emptySeverityCounts(),
        statuses: emptyStatusCounts(),
        evidence: [],
      };
      existing.findingIds.push(finding.id);
      existing.severity[finding.severity] += 1;
      existing.statuses[finding.computedStatus] += 1;
      existing.evidence.push(...finding.evidence);
      assertionMap.set(finding.assertion_id, existing);
    }
  }

  for (const assertion of assertionMap.values()) {
    assertion.evidence = [...new Set(assertion.evidence)];
  }

  return {
    reports,
    findings,
    counts: {
      total: findings.length,
      bySeverity,
      byStatus,
    },
    assertions: [...assertionMap.values()],
    openBlockingFindingCount: findings.filter(
      (finding) => finding.severity === "blocking" && finding.computedStatus === "open",
    ).length,
  };
}

function buildMilestones(input: {
  mission: Issue;
  descendants: Issue[];
  relationMap: Map<string, IssueRelations>;
  featurePlan: MissionFeaturesDocument | null;
}) {
  const { mission, descendants, relationMap, featurePlan } = input;
  const milestoneByKey = new Map<string, MissionMilestoneProjection>();
  const milestoneKeyByIssueId = new Map<string, string>();
  const milestoneKeyByFeatureKey = new Map<string, string>();
  const milestoneKeyByFixLoopIssueId = new Map<string, string>();

  for (const planned of featurePlan?.milestones ?? []) {
    const projection = createMilestoneProjection({
      key: planned.id,
      title: planned.title,
      summary: planned.summary,
      issue: null,
    });
    milestoneByKey.set(planned.id, projection);
    for (const feature of planned.features) {
      milestoneKeyByFeatureKey.set(feature.id, planned.id);
    }
  }

  const summaryByIssueId = new Map<string, MissionSummaryIssue>();
  for (const issue of descendants) {
    const relations = relationMap.get(issue.id);
    summaryByIssueId.set(issue.id, toSummaryIssue(issue, relations?.blockedBy ?? []));
  }

  const milestoneIssues = descendants.filter((issue) => issue.originKind === "mission_milestone");
  for (const issue of milestoneIssues) {
    const key = missionOriginKey(mission.id, issue, "milestone") ?? issue.id;
    const summaryIssue = summaryByIssueId.get(issue.id) ?? toSummaryIssue(issue, []);
    const existing = milestoneByKey.get(key);
    const projection = existing
      ? { ...existing, title: existing.title || issue.title, issue: summaryIssue }
      : createMilestoneProjection({ key, title: issue.title, summary: issue.description, issue: summaryIssue });
    milestoneByKey.set(key, projection);
    milestoneKeyByIssueId.set(issue.id, key);
  }

  for (const issue of descendants.filter((issue) => issue.originKind === "mission_fix_loop")) {
    const key = missionOriginKey(mission.id, issue, "fix_loop") ?? null;
    if (key) milestoneKeyByFixLoopIssueId.set(issue.id, key);
  }

  function ensureUngrouped() {
    const key = "ungrouped";
    const existing = milestoneByKey.get(key);
    if (existing) return existing;
    const projection = createMilestoneProjection({
      key,
      title: "Ungrouped mission work",
      summary: "Generated mission work that is not tied to a parsed milestone.",
      issue: null,
    });
    milestoneByKey.set(key, projection);
    return projection;
  }

  for (const issue of descendants) {
    const summaryIssue = summaryByIssueId.get(issue.id);
    if (!summaryIssue) continue;
    const featureKey = issue.originKind === "mission_feature" ? missionOriginKey(mission.id, issue, "feature") : null;
    const validationKey = issue.originKind === "mission_validation"
      ? missionOriginKey(mission.id, issue, "validation")
      : null;
    const fixLoopKey = issue.originKind === "mission_fix_loop" ? missionOriginKey(mission.id, issue, "fix_loop") : null;
    const milestoneKey =
      (featureKey ? milestoneKeyByFeatureKey.get(featureKey) : null) ??
      (validationKey ? validationMilestoneKey(validationKey) : null) ??
      fixLoopKey ??
      (issue.parentId ? milestoneKeyByFixLoopIssueId.get(issue.parentId) : null) ??
      (issue.parentId ? milestoneKeyByIssueId.get(issue.parentId) : null);

    const milestone = milestoneKey ? milestoneByKey.get(milestoneKey) ?? ensureUngrouped() : ensureUngrouped();
    if (issue.originKind === "mission_feature") milestone.features.push(summaryIssue);
    if (issue.originKind === "mission_validation") milestone.validations.push(summaryIssue);
    if (issue.originKind === "mission_fix_loop") milestone.fixLoops.push(summaryIssue);
  }

  for (const milestone of milestoneByKey.values()) {
    const work = [
      ...(milestone.issue ? [milestone.issue] : []),
      ...milestone.features,
      ...milestone.validations,
      ...milestone.fixLoops,
    ];
    milestone.blockers = uniqueBlockedWork(
      work
        .map((issue) => ({
          issue,
          blockers: issue.blockedBy.filter((blocker) => !isTerminalIssue(blocker)),
        }))
        .filter((item) => item.issue.status === "blocked" || item.blockers.length > 0),
    );
  }

  return [...milestoneByKey.values()];
}

function nextMissionAction(input: {
  missingDocuments: MissionRequiredDocumentKey[];
  documentErrorCount: number;
  blockers: MissionBlockedWorkItem[];
  activeWork: MissionSummaryIssue[];
  validationSummary: MissionValidationSummary;
  hasGeneratedWork: boolean;
  hasFinalReport: boolean;
  allGeneratedWorkTerminal: boolean;
}) {
  if (input.documentErrorCount > 0) return "Fix mission document parsing errors.";
  if (input.missingDocuments.length > 0) {
    return `Complete required mission documents: ${input.missingDocuments.join(", ")}.`;
  }
  if (input.blockers.length > 0) return "Resolve blocking issues before advancing mission work.";
  if (input.activeWork.some((issue) => issue.originKind === "mission_validation")) {
    return "Review active validation work and capture findings.";
  }
  if (input.validationSummary.openBlockingFindingCount > 0) {
    return "Create bounded fix issues for open blocking validation findings.";
  }
  if (input.validationSummary.counts.byStatus.open > 0) {
    return "Triage open non-blocking validation findings or record waivers.";
  }
  if (input.activeWork.some((issue) => issue.originKind === "mission_fix_loop")) {
    return "Triage validation findings and create bounded fix issues.";
  }
  if (input.activeWork.some((issue) => issue.originKind === "mission_feature" && !isGeneratedFixFeature(issue))) {
    return "Continue active feature work and collect implementation evidence.";
  }
  if (!input.hasGeneratedWork) return "Decompose the mission into milestone and feature issues.";
  if (input.allGeneratedWorkTerminal && !input.hasFinalReport) return "Write the final mission report.";
  return "Review mission state and choose the next controlled transition.";
}

export function buildIssueBackedMissionSummary(input: {
  mission: Issue;
  documentSummaries: IssueDocumentSummary[];
  validationDocument: IssueDocument | null;
  featuresDocument: IssueDocument | null;
  validationReportDocuments?: IssueDocument[];
  decisionLogDocument?: IssueDocument | null;
  descendants: Issue[];
  relationMap: Map<string, IssueRelations>;
  runSummary: IssueBackedMissionSummary["runSummary"];
  costSummary: IssueBackedMissionSummary["costSummary"];
}): IssueBackedMissionSummary {
  const { mission, documentSummaries, validationDocument, featuresDocument, descendants, relationMap } = input;
  const presentKeys = new Set(documentSummaries.map((document) => document.key));
  const documentChecklist = MISSION_REQUIRED_DOCUMENT_KEYS.map((key) => {
    const document = documentSummaries.find((candidate) => candidate.key === key);
    return {
      key,
      title: document?.title ?? null,
      present: Boolean(document),
      latestRevisionNumber: document?.latestRevisionNumber ?? null,
      updatedAt: document?.updatedAt ?? null,
    };
  });
  const missingDocuments = MISSION_REQUIRED_DOCUMENT_KEYS.filter((key) => !presentKeys.has(key));
  const documentErrors: IssueBackedMissionSummary["documentErrors"] = [];
  let featurePlan: MissionFeaturesDocument | null = null;
  const documents = [
    ...documentSummaries.filter((document): document is IssueDocument => "body" in document),
    ...(input.validationReportDocuments ?? []),
    ...(input.decisionLogDocument ? [input.decisionLogDocument] : []),
  ];

  if (validationDocument) {
    try {
      parseMissionValidationContractDocument(validationDocument.body);
    } catch (error) {
      documentErrors.push({ key: "validation-contract", message: documentErrorMessage(error) });
    }
  }
  if (featuresDocument) {
    try {
      featurePlan = parseMissionFeaturesDocument(featuresDocument.body);
    } catch (error) {
      documentErrors.push({ key: "features", message: documentErrorMessage(error) });
    }
  }

  const missionSummaryIssue = toSummaryIssue(mission, relationMap.get(mission.id)?.blockedBy ?? []);
  const descendantSummaries = descendants.map((issue) => toSummaryIssue(issue, relationMap.get(issue.id)?.blockedBy ?? []));
  const activeWork = descendantSummaries.filter((issue) => !isTerminalIssue(issue));
  const blockers = uniqueBlockedWork(
    [missionSummaryIssue, ...descendantSummaries]
      .map((issue) => ({
        issue,
        blockers: issue.blockedBy.filter((blocker) => !isTerminalIssue(blocker)),
      }))
      .filter((item) => item.issue.status === "blocked" || item.blockers.length > 0),
  );
  const milestones = buildMilestones({ mission, descendants, relationMap, featurePlan });
  const validationSummary = buildValidationSummary({
    mission,
    documents,
    descendants,
    relationMap,
    documentErrors,
  });
  const hasGeneratedWork = descendants.some((issue) => issue.originKind?.startsWith("mission_"));
  const hasFinalReport = presentKeys.has("mission-final-report");
  const allGeneratedWorkTerminal =
    hasGeneratedWork && descendants.filter((issue) => issue.originKind?.startsWith("mission_")).every(isTerminalIssue);
  const state = deriveIssueBackedMissionState({
    missionIssueStatus: mission.status,
    presentDocumentKeys: [...presentKeys],
    hasActiveFeatureIssues: activeWork.some((issue) => issue.originKind === "mission_feature" && !isGeneratedFixFeature(issue)),
    hasActiveValidationIssues: activeWork.some((issue) => issue.originKind === "mission_validation"),
    hasActiveFixIssues: activeWork.some((issue) => issue.originKind === "mission_fix_loop" || isGeneratedFixFeature(issue)),
    hasBlockingFindings: blockers.length > 0 || validationSummary.openBlockingFindingCount > 0,
  });

  return {
    missionIssueId: mission.id,
    missionIdentifier: mission.identifier ?? null,
    state,
    documentChecklist,
    missing_required_document_keys: missingDocuments,
    documentErrors,
    milestones,
    blockers,
    activeWork,
    validationSummary,
    runSummary: input.runSummary,
    costSummary: input.costSummary,
    next_action: nextMissionAction({
      missingDocuments,
      documentErrorCount: documentErrors.length,
      blockers,
      activeWork,
      validationSummary,
      hasGeneratedWork,
      hasFinalReport,
      allGeneratedWorkTerminal,
    }),
  };
}

export function missionSummaryService(db: Db) {
  const issuesSvc = issueService(db);
  const documentsSvc = documentService(db);

  async function listDescendants(companyId: string, rootIssueId: string) {
    const descendants: Issue[] = [];
    let frontier = [rootIssueId];
    while (frontier.length > 0) {
      const nextFrontier: string[] = [];
      for (const parentId of frontier) {
        const children = (await issuesSvc.list(companyId, { parentId })) as Issue[];
        descendants.push(...children);
        nextFrontier.push(...children.map((issue) => issue.id));
      }
      frontier = nextFrontier;
    }
    return descendants;
  }

  async function relationMapFor(issues: Issue[]) {
    const entries = await Promise.all(
      issues.map(async (issue) => [issue.id, await issuesSvc.getRelationSummaries(issue.id)] as const),
    );
    return new Map(entries);
  }

  async function readRunSummary(mission: Issue, descendants: Issue[]) {
    const runIds = [...new Set([mission, ...descendants].map((issue) => issue.executionRunId).filter(Boolean))] as string[];
    if (runIds.length === 0) {
      return {
        total: 0,
        active: 0,
        latestRunId: null,
        latestRunStatus: null,
      };
    }

    const runs = await db
      .select({
        id: heartbeatRuns.id,
        status: heartbeatRuns.status,
      })
      .from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.companyId, mission.companyId), inArray(heartbeatRuns.id, runIds)))
      .orderBy(desc(heartbeatRuns.startedAt), desc(heartbeatRuns.createdAt));

    return {
      total: runs.length,
      active: runs.filter((run) => ACTIVE_RUN_STATUSES.has(run.status)).length,
      latestRunId: runs[0]?.id ?? null,
      latestRunStatus: runs[0]?.status ?? null,
    };
  }

  async function readCostSummary(mission: Issue, descendants: Issue[]) {
    const issueIds = [mission.id, ...descendants.map((issue) => issue.id)];
    const issueCostFilter = inArray(costEvents.issueId, issueIds);
    const billingCostFilter = mission.billingCode ? eq(costEvents.billingCode, mission.billingCode) : undefined;
    const [row] = await db
      .select({
        costCents: sql<number>`COALESCE(SUM(${costEvents.costCents}), 0)`,
        inputTokens: sql<number>`COALESCE(SUM(${costEvents.inputTokens}), 0)`,
        outputTokens: sql<number>`COALESCE(SUM(${costEvents.outputTokens}), 0)`,
      })
      .from(costEvents)
      .where(
        and(
          eq(costEvents.companyId, mission.companyId),
          billingCostFilter ? or(issueCostFilter, billingCostFilter) : issueCostFilter,
        ),
      );

    return {
      costCents: Number(row?.costCents ?? 0),
      inputTokens: Number(row?.inputTokens ?? 0),
      outputTokens: Number(row?.outputTokens ?? 0),
    };
  }

  return {
    getSummary: async (issueId: string): Promise<IssueBackedMissionSummary> => {
      const rawMission = await issuesSvc.getById(issueId);
      if (!rawMission) throw notFound("Mission issue not found");
      const mission = rawMission as Issue;

      const [rawDocumentSummaries, rawValidationDocument, rawFeaturesDocument, descendants] = await Promise.all([
        documentsSvc.listIssueDocuments(mission.id),
        documentsSvc.getIssueDocumentByKey(mission.id, "validation-contract"),
        documentsSvc.getIssueDocumentByKey(mission.id, "features"),
        listDescendants(mission.companyId, mission.id),
      ]);
      const documentSummaries = rawDocumentSummaries as IssueDocumentSummary[];
      const validationDocument = rawValidationDocument as IssueDocument | null;
      const featuresDocument = rawFeaturesDocument as IssueDocument | null;

      const relationMap = await relationMapFor([mission, ...descendants]);
      const [runSummary, costSummary] = await Promise.all([
        readRunSummary(mission, descendants),
        readCostSummary(mission, descendants),
      ]);

      return buildIssueBackedMissionSummary({
        mission,
        documentSummaries,
        validationDocument,
        featuresDocument,
        descendants,
        relationMap,
        runSummary,
        costSummary,
      });
    },
  };
}
