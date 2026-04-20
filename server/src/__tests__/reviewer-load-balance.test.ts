import { describe, expect, it } from "vitest";
import { resolveAutoReviewer } from "../services/issues.ts";
import type { ReviewerCandidate } from "../services/issues.ts";

const reviewer1Id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const reviewer2Id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const executorId  = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function makeReviewer(id: string, activeReviewCount: number, createdAtMs = 1000): ReviewerCandidate {
  return {
    id,
    status: "active",
    createdAt: new Date(createdAtMs),
    activeReviewCount,
  };
}

describe("resolveAutoReviewer", () => {
  it("single reviewer → always picked", () => {
    const result = resolveAutoReviewer({
      defaultReviewerAgentId: reviewer1Id,
      reviewers: [makeReviewer(reviewer1Id, 3)],
      assigneeAgentId: executorId,
    });
    expect(result).toBe(reviewer1Id);
  });

  it("two reviewers with equal load → primary (defaultReviewerAgentId) wins tiebreak", () => {
    const result = resolveAutoReviewer({
      defaultReviewerAgentId: reviewer1Id,
      reviewers: [
        makeReviewer(reviewer1Id, 2, 1000),
        makeReviewer(reviewer2Id, 2, 500), // older but not primary
      ],
      assigneeAgentId: executorId,
    });
    expect(result).toBe(reviewer1Id);
  });

  it("two reviewers with equal load, no default set → oldest gets the work", () => {
    const result = resolveAutoReviewer({
      defaultReviewerAgentId: null,
      reviewers: [
        makeReviewer(reviewer1Id, 2, 2000),
        makeReviewer(reviewer2Id, 2, 1000), // older
      ],
      assigneeAgentId: executorId,
    });
    expect(result).toBe(reviewer2Id);
  });

  it("asymmetric load → less-loaded reviewer gets the new attach", () => {
    const result = resolveAutoReviewer({
      defaultReviewerAgentId: reviewer1Id,
      reviewers: [
        makeReviewer(reviewer1Id, 5, 1000), // primary but loaded
        makeReviewer(reviewer2Id, 1, 2000), // lighter load
      ],
      assigneeAgentId: executorId,
    });
    expect(result).toBe(reviewer2Id);
  });

  it("defaultReviewerAgentId points to a deleted/absent agent → fallback to any active reviewer", () => {
    const deletedId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const result = resolveAutoReviewer({
      defaultReviewerAgentId: deletedId, // not present in reviewers list
      reviewers: [makeReviewer(reviewer2Id, 0, 1000)],
      assigneeAgentId: executorId,
    });
    expect(result).toBe(reviewer2Id);
  });

  it("returns null when no reviewers are available", () => {
    const result = resolveAutoReviewer({
      defaultReviewerAgentId: null,
      reviewers: [],
      assigneeAgentId: executorId,
    });
    expect(result).toBeNull();
  });

  it("excludes reviewers whose status is not eligible", () => {
    const result = resolveAutoReviewer({
      defaultReviewerAgentId: reviewer1Id,
      reviewers: [
        { id: reviewer1Id, status: "terminated", createdAt: new Date(1000), activeReviewCount: 0 },
        makeReviewer(reviewer2Id, 0, 2000),
      ],
      assigneeAgentId: executorId,
    });
    expect(result).toBe(reviewer2Id);
  });

  it("excludes reviewer who is also the assignee", () => {
    const result = resolveAutoReviewer({
      defaultReviewerAgentId: reviewer1Id,
      reviewers: [
        makeReviewer(reviewer1Id, 0, 1000),
        makeReviewer(reviewer2Id, 0, 2000),
      ],
      assigneeAgentId: reviewer1Id, // reviewer1 is the assignee
    });
    expect(result).toBe(reviewer2Id);
  });
});
