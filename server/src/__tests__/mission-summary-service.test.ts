import { describe, expect, it } from "vitest";
import { MISSION_REQUIRED_DOCUMENT_KEYS, type Issue, type IssueDocument } from "@paperclipai/shared";
import { buildIssueBackedMissionSummary } from "../services/mission-summary.js";

const now = new Date("2026-04-17T22:00:00.000Z");

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "mission-1",
    companyId: "company-1",
    projectId: null,
    projectWorkspaceId: null,
    goalId: null,
    parentId: null,
    title: "Mission: summarize work",
    description: "Build mission summary.",
    status: "in_progress",
    priority: "medium",
    assigneeAgentId: null,
    assigneeUserId: null,
    checkoutRunId: null,
    executionRunId: null,
    executionAgentNameKey: null,
    executionLockedAt: null,
    createdByAgentId: null,
    createdByUserId: null,
    issueNumber: 1533,
    identifier: "PAP-1533",
    originKind: "mission",
    originId: "PAP-1533",
    originRunId: null,
    requestDepth: 0,
    billingCode: "mission:PAP-1533",
    assigneeAdapterOverrides: null,
    executionWorkspaceId: null,
    executionWorkspacePreference: null,
    executionWorkspaceSettings: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    hiddenAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function doc(key: string, body: string): IssueDocument {
  return {
    id: `doc-${key}`,
    companyId: "company-1",
    issueId: "mission-1",
    key,
    title: key,
    format: "markdown",
    body,
    latestRevisionId: `rev-${key}`,
    latestRevisionNumber: 1,
    createdByAgentId: null,
    createdByUserId: null,
    updatedByAgentId: null,
    updatedByUserId: null,
    createdAt: now,
    updatedAt: now,
  };
}

function requiredDocs() {
  const validationContract = JSON.stringify({
    assertions: [
      {
        id: "VAL-MISSION-001",
        title: "Mission summary visible",
        user_value: "The board can inspect progress without reading transcripts.",
        scope: "mission summary",
        setup: "Initialized mission.",
        steps: ["Open the mission issue."],
        oracle: "Summary appears.",
        tooling: ["api_call"],
        evidence: [{ kind: "json", description: "Summary response", required: true }],
        claimed_by: ["FEAT-MISSION-001"],
        status: "claimed",
      },
    ],
  });
  const features = JSON.stringify({
    milestones: [
      {
        id: "MILESTONE-MISSION-001",
        title: "Foundation",
        summary: "Create the summary projection.",
        features: [
          {
            id: "FEAT-MISSION-001",
            title: "Create summary",
            kind: "original",
            summary: "Return mission state.",
            acceptance_criteria: ["Documents are represented."],
            claimed_assertion_ids: ["VAL-MISSION-001"],
            status: "planned",
          },
        ],
      },
    ],
  });

  return MISSION_REQUIRED_DOCUMENT_KEYS.map((key) => (
    doc(
      key,
      key === "validation-contract" ? validationContract : key === "features" ? features : `# ${key}`,
    )
  ));
}

function summarize(input: {
  mission?: Issue;
  documents?: IssueDocument[];
  descendants?: Issue[];
  relationMap?: Map<string, { blockedBy: any[]; blocks: any[] }>;
}) {
  const documents = input.documents ?? [];
  return buildIssueBackedMissionSummary({
    mission: input.mission ?? issue(),
    documentSummaries: documents,
    validationDocument: documents.find((document) => document.key === "validation-contract") ?? null,
    featuresDocument: documents.find((document) => document.key === "features") ?? null,
    descendants: input.descendants ?? [],
    relationMap: input.relationMap ?? new Map([["mission-1", { blockedBy: [], blocks: [] }]]),
    runSummary: {
      total: 0,
      active: 0,
      latestRunId: null,
      latestRunStatus: null,
    },
    costSummary: {
      costCents: 0,
      inputTokens: 0,
      outputTokens: 0,
    },
  });
}

describe("buildIssueBackedMissionSummary", () => {
  it("reports missing required mission documents", () => {
    const summary = summarize({});

    expect(summary.state).toBe("draft");
    expect(summary.missing_required_document_keys).toEqual([...MISSION_REQUIRED_DOCUMENT_KEYS]);
    expect(summary.documentChecklist.every((item) => !item.present)).toBe(true);
    expect(summary.next_action).toContain("Complete required mission documents");
  });

  it("groups blocked child issues and exposes unresolved blockers", () => {
    const mission = issue();
    const milestone = issue({
      id: "milestone-1",
      parentId: mission.id,
      title: "Mission milestone: Foundation",
      status: "blocked",
      originKind: "mission_milestone",
      originId: `${mission.id}:milestone:MILESTONE-MISSION-001`,
    });
    const feature = issue({
      id: "feature-1",
      parentId: milestone.id,
      title: "Mission feature: Create summary",
      status: "blocked",
      originKind: "mission_feature",
      originId: `${mission.id}:feature:FEAT-MISSION-001`,
    });
    const blocker = {
      id: "blocker-1",
      identifier: "PAP-9",
      title: "Finish prerequisite",
      status: "todo" as const,
      priority: "medium" as const,
      assigneeAgentId: null,
      assigneeUserId: null,
    };
    const summary = summarize({
      mission,
      documents: requiredDocs(),
      descendants: [milestone, feature],
      relationMap: new Map([
        [mission.id, { blockedBy: [], blocks: [] }],
        [milestone.id, { blockedBy: [], blocks: [] }],
        [feature.id, { blockedBy: [blocker], blocks: [] }],
      ]),
    });

    expect(summary.state).toBe("blocked");
    expect(summary.blockers.map((item) => item.issue.id)).toContain(feature.id);
    expect(summary.blockers.find((item) => item.issue.id === feature.id)?.blockers[0]?.id).toBe(blocker.id);
    expect(summary.milestones[0]?.features[0]?.id).toBe(feature.id);
    expect(summary.next_action).toBe("Resolve blocking issues before advancing mission work.");
  });

  it("reports complete docs and planned milestone groups", () => {
    const summary = summarize({
      documents: requiredDocs(),
    });

    expect(summary.missing_required_document_keys).toEqual([]);
    expect(summary.documentChecklist.every((item) => item.present)).toBe(true);
    expect(summary.state).toBe("planning");
    expect(summary.milestones).toHaveLength(1);
    expect(summary.milestones[0]?.key).toBe("MILESTONE-MISSION-001");
    expect(summary.next_action).toBe("Decompose the mission into milestone and feature issues.");
  });

  it("summarizes validation findings with evidence and assertion mapping", () => {
    const report = doc("validation-report-round-1", JSON.stringify({
      round: 1,
      validator_role: "scrutiny_validator",
      summary: "Found one blocking issue.",
      findings: [
        {
          id: "FINDING-MISSION-001",
          severity: "blocking",
          assertion_id: "VAL-MISSION-001",
          title: "Summary omits blockers",
          evidence: ["API response did not include blockers."],
          repro_steps: ["Create blocked child issue.", "Fetch mission summary."],
          expected: "The blocker appears in the summary.",
          actual: "The blocker is absent.",
          recommended_fix_scope: "Include blocker rows.",
          status: "open",
        },
      ],
    }));
    const summary = summarize({
      documents: [...requiredDocs(), report],
    });

    expect(summary.validationSummary.counts.bySeverity.blocking).toBe(1);
    expect(summary.validationSummary.openBlockingFindingCount).toBe(1);
    expect(summary.validationSummary.assertions[0]?.assertion_id).toBe("VAL-MISSION-001");
    expect(summary.validationSummary.assertions[0]?.evidence).toEqual(["API response did not include blockers."]);
    expect(summary.next_action).toBe("Create bounded fix issues for open blocking validation findings.");
  });

  it("reports validation report parser errors", () => {
    const summary = summarize({
      documents: [...requiredDocs(), doc("validation-report-round-1", JSON.stringify({ findings: [] }))],
    });

    expect(summary.documentErrors.some((error) => error.key === "validation-report-round-1")).toBe(true);
  });

  it("marks non-blocking findings as waived from the decision log", () => {
    const report = doc("validation-report-round-1", JSON.stringify({
      round: 1,
      validator_role: "user_testing_validator",
      summary: "Found one non-blocking issue.",
      findings: [
        {
          id: "FINDING-MISSION-002",
          severity: "non_blocking",
          assertion_id: "VAL-MISSION-001",
          title: "Copy could be clearer",
          evidence: ["Screenshot attached in validation comment."],
          repro_steps: ["Open the mission summary."],
          expected: "Copy is clear.",
          actual: "Copy is understandable but terse.",
          status: "open",
        },
      ],
    }));
    const decisionLog = doc(
      "decision-log",
      [
        "# Decision Log",
        "",
        "<!-- paperclip:mission-finding-waiver:FINDING-MISSION-002 -->",
        "### Waived FINDING-MISSION-002",
        "",
        "- Rationale: Acceptable for MVP.",
      ].join("\n"),
    );

    const summary = summarize({
      documents: [...requiredDocs().filter((document) => document.key !== "decision-log"), decisionLog, report],
    });

    expect(summary.validationSummary.findings[0]?.computedStatus).toBe("waived");
    expect(summary.validationSummary.counts.byStatus.waived).toBe(1);
    expect(summary.validationSummary.findings[0]?.waiver?.rationale).toBe("Acceptable for MVP.");
  });
});
