import type {
  IssueOriginKind,
  IssuePriority,
  IssueStatus,
  MissionFeatureKind,
  MissionFeatureStatus,
  MissionFindingSeverity,
  MissionFindingStatus,
  MissionRequiredDocumentKey,
  MissionRoleType,
  MissionState,
  MissionValidationAssertionStatus,
  MissionValidationTooling,
} from "../constants.js";
import type { IssueRelationIssueSummary } from "./issue.js";

export interface MissionEvidenceRequirement {
  kind: string;
  description: string;
  required: boolean;
}

export interface MissionValidationAssertion {
  id: string;
  title: string;
  user_value: string;
  scope: string;
  setup: string;
  steps: string[];
  oracle: string;
  tooling: MissionValidationTooling[];
  evidence: MissionEvidenceRequirement[];
  claimed_by: string[];
  status: MissionValidationAssertionStatus;
}

export interface MissionValidationContract {
  assertions: MissionValidationAssertion[];
}

export interface MissionFeature {
  id: string;
  title: string;
  kind: MissionFeatureKind;
  summary: string;
  acceptance_criteria: string[];
  claimed_assertion_ids: string[];
  status: MissionFeatureStatus;
  source_finding_id?: string | null;
}

export interface MissionMilestone {
  id: string;
  title: string;
  summary: string;
  features: MissionFeature[];
}

export interface MissionFeaturesDocument {
  milestones: MissionMilestone[];
}

export interface MissionFinding {
  id: string;
  severity: MissionFindingSeverity;
  assertion_id?: string | null;
  title: string;
  evidence: string[];
  repro_steps: string[];
  expected: string;
  actual: string;
  suspected_area?: string | null;
  recommended_fix_scope?: string | null;
  status: MissionFindingStatus;
}

export interface MissionValidationReport {
  round: number;
  validator_role: Extract<MissionRoleType, "scrutiny_validator" | "user_testing_validator">;
  summary: string;
  findings: MissionFinding[];
}

export interface MissionValidationReportProjection extends MissionValidationReport {
  documentKey: string;
  documentTitle: string | null;
  updatedAt: Date | null;
}

export interface MissionFindingWaiver {
  findingId: string;
  rationale: string;
}

export interface MissionFindingProjection extends MissionFinding {
  sourceReportKey: string;
  sourceReportTitle: string | null;
  round: number;
  validator_role: MissionValidationReport["validator_role"];
  computedStatus: MissionFindingStatus;
  fixIssue: MissionSummaryIssue | null;
  waiver: MissionFindingWaiver | null;
}

export interface MissionValidationFindingCounts {
  total: number;
  bySeverity: Record<MissionFindingSeverity, number>;
  byStatus: Record<MissionFindingStatus, number>;
}

export interface MissionValidationAssertionFindingSummary {
  assertion_id: string;
  findingIds: string[];
  severity: Record<MissionFindingSeverity, number>;
  statuses: Record<MissionFindingStatus, number>;
  evidence: string[];
}

export interface MissionValidationSummary {
  reports: MissionValidationReportProjection[];
  findings: MissionFindingProjection[];
  counts: MissionValidationFindingCounts;
  assertions: MissionValidationAssertionFindingSummary[];
  openBlockingFindingCount: number;
}

export interface IssueBackedMissionSummary {
  missionIssueId: string;
  missionIdentifier: string | null;
  state: MissionState;
  documentChecklist: MissionDocumentChecklistItem[];
  missing_required_document_keys: MissionRequiredDocumentKey[];
  documentErrors: MissionDocumentError[];
  milestones: MissionMilestoneProjection[];
  blockers: MissionBlockedWorkItem[];
  activeWork: MissionSummaryIssue[];
  validationSummary: MissionValidationSummary;
  runSummary: MissionRunSummary;
  costSummary: MissionCostSummary;
  next_action: string;
}

export interface MissionDocumentChecklistItem {
  key: MissionRequiredDocumentKey;
  title: string | null;
  present: boolean;
  latestRevisionNumber: number | null;
  updatedAt: Date | null;
}

export interface MissionDocumentError {
  key: string;
  message: string;
}

export interface MissionSummaryIssue {
  id: string;
  identifier: string | null;
  title: string;
  status: IssueStatus;
  priority: IssuePriority;
  originKind: IssueOriginKind;
  originId: string | null;
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
  executionRunId: string | null;
  blockedBy: IssueRelationIssueSummary[];
}

export interface MissionMilestoneProjection {
  key: string;
  title: string;
  summary: string | null;
  issue: MissionSummaryIssue | null;
  features: MissionSummaryIssue[];
  validations: MissionSummaryIssue[];
  fixLoops: MissionSummaryIssue[];
  blockers: MissionBlockedWorkItem[];
}

export interface MissionBlockedWorkItem {
  issue: MissionSummaryIssue;
  blockers: IssueRelationIssueSummary[];
}

export interface MissionRunSummary {
  total: number;
  active: number;
  latestRunId: string | null;
  latestRunStatus: string | null;
}

export interface MissionCostSummary {
  costCents: number;
  inputTokens: number;
  outputTokens: number;
}

export type MissionGeneratedIssueKind = "milestone" | "feature" | "validation" | "fix_loop";

export interface MissionDecomposedIssue {
  kind: MissionGeneratedIssueKind;
  key: string;
  issueId: string;
  identifier: string | null;
  title: string;
  created: boolean;
  blockedByIssueIds: string[];
}

export interface MissionDecompositionResult {
  missionIssueId: string;
  milestoneCount: number;
  featureCount: number;
  validationCount: number;
  fixLoopCount: number;
  createdIssueIds: string[];
  updatedIssueIds: string[];
  issues: MissionDecomposedIssue[];
}

export interface MissionWaiveFindingResult {
  missionIssueId: string;
  findingId: string;
  waived: boolean;
  decisionLogDocumentId: string;
  latestRevisionId: string | null;
}
