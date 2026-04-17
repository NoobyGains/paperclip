import { describe, expect, it } from "vitest";
import {
  deriveIssueBackedMissionState,
  getMissionMilestoneSummaryDocumentKey,
  getMissionValidationReportDocumentKey,
  isMissionDocumentKey,
} from "./mission.js";
import {
  parseMissionFeaturesDocument,
  parseMissionValidationContractDocument,
} from "./mission-documents.js";
import {
  advanceMissionSchema,
  decomposeMissionSchema,
  missionDocumentKeySchema,
  missionFeaturesDocumentSchema,
  missionFindingSchema,
  missionStateDerivationInputSchema,
  missionValidationContractSchema,
  missionValidationReportSchema,
} from "./validators/mission.js";

describe("mission document keys", () => {
  it("accepts required and generated mission document keys", () => {
    expect(missionDocumentKeySchema.parse("validation-contract")).toBe("validation-contract");
    expect(missionDocumentKeySchema.parse("validation-report-round-2")).toBe("validation-report-round-2");
    expect(missionDocumentKeySchema.parse("milestone-summary-foundation")).toBe("milestone-summary-foundation");
    expect(missionDocumentKeySchema.parse("mission-final-report")).toBe("mission-final-report");
    expect(isMissionDocumentKey("unknown")).toBe(false);
  });

  it("builds generated document keys from canonical helpers", () => {
    expect(getMissionValidationReportDocumentKey(3)).toBe("validation-report-round-3");
    expect(getMissionMilestoneSummaryDocumentKey("Foundation_1")).toBe("milestone-summary-foundation_1");
    expect(() => getMissionValidationReportDocumentKey(0)).toThrow("positive integers");
    expect(() => getMissionMilestoneSummaryDocumentKey("not valid")).toThrow("document-key-safe");
  });
});

describe("mission validation contract schema", () => {
  it("accepts testable assertions with evidence requirements", () => {
    const parsed = missionValidationContractSchema.parse({
      assertions: [
        {
          id: "VAL-MISSION-001",
          title: "Mission creates issue-backed state",
          user_value: "The board can inspect mission work as normal Paperclip work.",
          scope: "mission initialization",
          setup: "A company with a project and active orchestrator.",
          steps: ["Initialize a mission from an existing issue.", "Inspect mission issue documents."],
          oracle: "Required documents exist and no unscoped work is created.",
          tooling: ["api_call", "manual_review"],
          evidence: [
            {
              kind: "api-response",
              description: "JSON response listing created mission documents.",
              required: true,
            },
          ],
          claimed_by: ["FEAT-MISSION-001"],
          status: "claimed",
        },
      ],
    });

    expect(parsed.assertions[0]?.id).toBe("VAL-MISSION-001");
  });

  it("rejects duplicate assertion IDs", () => {
    const result = missionValidationContractSchema.safeParse({
      assertions: [
        makeAssertion("VAL-MISSION-001"),
        makeAssertion("VAL-MISSION-001"),
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes("Duplicate validation assertion id"))).toBe(true);
    }
  });
});

describe("mission document parsers", () => {
  it("parses validation assertions from structured markdown", () => {
    const parsed = parseMissionValidationContractDocument(`
### VAL-MISSION-001: Mission creates issue-backed state

- User value: The board can inspect mission work as normal Paperclip work.
- Scope: mission initialization
- Setup: A company with a project and active orchestrator.
- Steps: Initialize a mission from an existing issue; inspect mission issue documents.
- Oracle: Required documents exist and no unscoped work is created.
- Tooling: api call, manual review
- Evidence: API response listing created mission documents.
- Claimed by: FEAT-MISSION-001
- Status: claimed
`);

    expect(parsed.assertions[0]?.id).toBe("VAL-MISSION-001");
    expect(parsed.assertions[0]?.steps).toHaveLength(2);
    expect(parsed.assertions[0]?.tooling).toEqual(["api_call", "manual_review"]);
  });

  it("parses milestone feature lists from structured markdown", () => {
    const parsed = parseMissionFeaturesDocument(`
## MILESTONE-MISSION-001: Foundation

- Summary: Create the mission state contract.

### FEAT-MISSION-001: Create mission documents

- Summary: Add required document contracts.
- Acceptance criteria: Shared constants list every required mission document key.
- Claims: VAL-MISSION-001
- Status: planned
`);

    expect(parsed.milestones[0]?.id).toBe("MILESTONE-MISSION-001");
    expect(parsed.milestones[0]?.features[0]?.id).toBe("FEAT-MISSION-001");
    expect(parsed.milestones[0]?.features[0]?.claimed_assertion_ids).toEqual(["VAL-MISSION-001"]);
  });

  it("rejects parsed markdown that does not satisfy the contract schema", () => {
    expect(() =>
      parseMissionValidationContractDocument(`
### VAL-MISSION-001: Missing required fields

- User value: Incomplete contract should fail.
`),
    ).toThrow();
  });
});

describe("mission features document schema", () => {
  it("accepts milestones with assertion-claiming features", () => {
    const parsed = missionFeaturesDocumentSchema.parse({
      milestones: [
        {
          id: "MILESTONE-MISSION-001",
          title: "Foundation",
          summary: "Create the mission state contract.",
          features: [
            {
              id: "FEAT-MISSION-001",
              title: "Create mission documents",
              kind: "original",
              summary: "Add required document contracts.",
              acceptance_criteria: ["Shared constants list every required mission document key."],
              claimed_assertion_ids: ["VAL-MISSION-001"],
              status: "planned",
            },
          ],
        },
      ],
    });

    expect(parsed.milestones[0]?.features[0]?.claimed_assertion_ids).toEqual(["VAL-MISSION-001"]);
  });

  it("rejects original features that claim no assertions", () => {
    const result = missionFeaturesDocumentSchema.safeParse({
      milestones: [
        {
          id: "MILESTONE-MISSION-001",
          title: "Foundation",
          summary: "Create the mission state contract.",
          features: [
            {
              id: "FEAT-MISSION-001",
              title: "Create mission documents",
              kind: "original",
              summary: "Add required document contracts.",
              acceptance_criteria: ["Shared constants list every required mission document key."],
              claimed_assertion_ids: [],
            },
          ],
        },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes("must claim"))).toBe(true);
    }
  });
});

describe("mission finding and report schemas", () => {
  it("accepts structured validation findings in reports", () => {
    const parsed = missionValidationReportSchema.parse({
      round: 1,
      validator_role: "scrutiny_validator",
      summary: "One blocking finding found.",
      findings: [
        {
          id: "FINDING-MISSION-001",
          severity: "blocking",
          assertion_id: "VAL-MISSION-001",
          title: "Required document missing",
          evidence: ["API response omitted validation-contract."],
          repro_steps: ["Initialize mission.", "List issue documents."],
          expected: "validation-contract exists.",
          actual: "validation-contract is absent.",
          recommended_fix_scope: "Create the missing document idempotently.",
          status: "fix_created",
        },
      ],
    });

    expect(parsed.findings[0]?.severity).toBe("blocking");
  });

  it("rejects blocking findings without assertion references", () => {
    const result = missionFindingSchema.safeParse({
      id: "FINDING-MISSION-001",
      severity: "blocking",
      title: "Required document missing",
      evidence: ["API response omitted validation-contract."],
      repro_steps: ["Initialize mission.", "List issue documents."],
      expected: "validation-contract exists.",
      actual: "validation-contract is absent.",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes("must reference"))).toBe(true);
    }
  });
});

describe("issue-backed mission state derivation", () => {
  it("derives draft, active, and terminal mission states from issue/document inputs", () => {
    expect(
      deriveIssueBackedMissionState({
        missionIssueStatus: "in_progress",
        presentDocumentKeys: ["mission-brief"],
      }),
    ).toBe("draft");

    expect(
      deriveIssueBackedMissionState({
        missionIssueStatus: "in_progress",
        presentDocumentKeys: ["mission-brief", "validation-contract", "features"],
        hasActiveValidationIssues: true,
      }),
    ).toBe("validating");

    expect(
      deriveIssueBackedMissionState({
        missionIssueStatus: "done",
        presentDocumentKeys: ["mission-brief", "validation-contract", "features", "mission-final-report"],
      }),
    ).toBe("completed");
  });

  it("validates derivation inputs against canonical document keys", () => {
    expect(() =>
      missionStateDerivationInputSchema.parse({
        missionIssueStatus: "in_progress",
        presentDocumentKeys: ["invalid-key"],
      }),
    ).toThrow("Unknown mission document key");
  });
});

describe("mission action validators", () => {
  it("defaults mission decomposition to a mutating run", () => {
    expect(decomposeMissionSchema.parse({})).toEqual({ dryRun: false });
    expect(decomposeMissionSchema.parse({ dryRun: true })).toEqual({ dryRun: true });
  });

  it("validates mission advance limits", () => {
    expect(advanceMissionSchema.parse({ budgetLimitCents: 100, maxValidationRounds: 2 })).toEqual({
      budgetLimitCents: 100,
      maxValidationRounds: 2,
    });
    expect(() => advanceMissionSchema.parse({ budgetLimitCents: 0 })).toThrow();
    expect(() => advanceMissionSchema.parse({ maxValidationRounds: 21 })).toThrow();
  });
});

function makeAssertion(id: string) {
  return {
    id,
    title: "Mission creates issue-backed state",
    user_value: "The board can inspect mission work as normal Paperclip work.",
    scope: "mission initialization",
    setup: "A company with a project and active orchestrator.",
    steps: ["Initialize a mission from an existing issue."],
    oracle: "Required documents exist.",
    tooling: ["api_call"],
    evidence: [{ kind: "api-response", description: "JSON response.", required: true }],
    claimed_by: ["FEAT-MISSION-001"],
    status: "claimed",
  };
}
