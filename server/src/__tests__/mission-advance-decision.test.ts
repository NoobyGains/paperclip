import { describe, expect, it } from "vitest";
import { advanceMissionSchema } from "@paperclipai/shared";
import { chooseMissionAdvanceStop } from "../services/missions.js";

describe("mission advance stop decisions", () => {
  it("validates advance limits at the API contract boundary", () => {
    expect(advanceMissionSchema.parse({ budgetLimitCents: 100, maxValidationRounds: 2 })).toEqual({
      budgetLimitCents: 100,
      maxValidationRounds: 2,
    });
    expect(() => advanceMissionSchema.parse({ budgetLimitCents: 0 })).toThrow();
    expect(() => advanceMissionSchema.parse({ maxValidationRounds: 21 })).toThrow();
  });

  it("stops on budget before unresolved blockers", () => {
    const result = chooseMissionAdvanceStop({
      pendingApprovalIssueIds: [],
      budgetStop: { kind: "mission_budget_limit", spendCents: 120, budgetLimitCents: 100 },
      maxRoundStop: null,
      unresolvedBlockers: [
        {
          issueId: "issue-1",
          issueIdentifier: "PAP-1",
          issueTitle: "Blocked issue",
          blockerIssueId: "issue-2",
          blockerIdentifier: "PAP-2",
          blockerTitle: "Blocker",
          blockerStatus: "todo",
        },
      ],
    });

    expect(result?.reason).toBe("budget_limit");
    expect(result?.details).toEqual({
      budgetStop: { kind: "mission_budget_limit", spendCents: 120, budgetLimitCents: 100 },
    });
  });

  it("stops on max validation rounds before unresolved blockers", () => {
    const result = chooseMissionAdvanceStop({
      pendingApprovalIssueIds: [],
      budgetStop: null,
      maxRoundStop: {
        milestoneIssueId: "milestone-1",
        validationRounds: 2,
        maxValidationRounds: 2,
      },
      unresolvedBlockers: [
        {
          issueId: "issue-1",
          issueIdentifier: "PAP-1",
          issueTitle: "Blocked issue",
          blockerIssueId: "issue-2",
          blockerIdentifier: "PAP-2",
          blockerTitle: "Blocker",
          blockerStatus: "todo",
        },
      ],
    });

    expect(result?.reason).toBe("max_validation_rounds");
  });

  it("stops on unresolved blockers when there is no earlier stop", () => {
    const blocker = {
      issueId: "issue-1",
      issueIdentifier: "PAP-1",
      issueTitle: "Blocked issue",
      blockerIssueId: "issue-2",
      blockerIdentifier: "PAP-2",
      blockerTitle: "Blocker",
      blockerStatus: "todo",
    };
    const result = chooseMissionAdvanceStop({
      pendingApprovalIssueIds: [],
      budgetStop: null,
      maxRoundStop: null,
      unresolvedBlockers: [blocker],
    });

    expect(result).toEqual({
      reason: "unresolved_blockers",
      details: { unresolvedBlockers: [blocker] },
    });
  });

  it("does not stop on blockers while other mission work can still be woken", () => {
    const result = chooseMissionAdvanceStop({
      pendingApprovalIssueIds: [],
      budgetStop: null,
      maxRoundStop: null,
      wakeableIssueCount: 1,
      unresolvedBlockers: [
        {
          issueId: "validation-1",
          issueIdentifier: "PAP-3",
          issueTitle: "Validation gate",
          blockerIssueId: "feature-1",
          blockerIdentifier: "PAP-2",
          blockerTitle: "Feature work",
          blockerStatus: "todo",
        },
      ],
    });

    expect(result).toBeNull();
  });
});
