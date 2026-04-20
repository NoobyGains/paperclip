import { describe, expect, it, vi } from "vitest";
import { mapGithubPriority, githubIssueBridgeService } from "../services/github-issue-bridge.js";
import type { GithubLabel } from "../services/github-issue-bridge.js";

// ---------------------------------------------------------------------------
// Unit tests — mapGithubPriority
// ---------------------------------------------------------------------------

describe("mapGithubPriority", () => {
  it("returns 'critical' for a priority:critical label", () => {
    expect(mapGithubPriority([{ name: "priority:critical" }])).toBe("critical");
  });

  it("returns 'high' for a priority:high label", () => {
    expect(mapGithubPriority([{ name: "priority:high" }])).toBe("high");
  });

  it("returns 'medium' for a priority:medium label", () => {
    expect(mapGithubPriority([{ name: "priority:medium" }])).toBe("medium");
  });

  it("returns 'low' for a priority:low label", () => {
    expect(mapGithubPriority([{ name: "priority:low" }])).toBe("low");
  });

  it("defaults to 'medium' when no priority label is present", () => {
    expect(mapGithubPriority([{ name: "bug" }, { name: "enhancement" }])).toBe("medium");
  });

  it("defaults to 'medium' for an empty label list", () => {
    expect(mapGithubPriority([])).toBe("medium");
  });

  it("is case-insensitive", () => {
    expect(mapGithubPriority([{ name: "Priority:High" }])).toBe("high");
    expect(mapGithubPriority([{ name: "PRIORITY:CRITICAL" }])).toBe("critical");
    expect(mapGithubPriority([{ name: "Priority:LOW" }])).toBe("low");
  });

  it("picks the first matching priority label when multiple are present", () => {
    const labels: GithubLabel[] = [
      { name: "priority:high" },
      { name: "priority:low" },
    ];
    expect(mapGithubPriority(labels)).toBe("high");
  });

  it("ignores labels that partially match but are not exact", () => {
    expect(mapGithubPriority([{ name: "my-priority:high" }])).toBe("medium");
    expect(mapGithubPriority([{ name: "priority:highest" }])).toBe("medium");
  });
});

// ---------------------------------------------------------------------------
// Integration test — mirrorIssues propagates priority:high → priority "high"
// ---------------------------------------------------------------------------

// vi.mock is hoisted to the top of the module — capture results via a
// module-level array so the factory closure can reference it.
const capturedCreates: unknown[] = [];

vi.mock("../services/issues.js", () => ({
  issueService: () => ({
    create: vi.fn().mockImplementation((_companyId: string, data: Record<string, unknown>) => {
      const issue = { id: "mock-id", ...data };
      capturedCreates.push(issue);
      return Promise.resolve(issue);
    }),
  }),
}));

describe("githubIssueBridgeService.mirrorIssues", () => {
  it("mirrors a GitHub issue with priority:high into paperclip with priority 'high'", async () => {
    capturedCreates.length = 0; // reset between tests

    const mockDb = {} as any;

    const result = await githubIssueBridgeService(mockDb).mirrorIssues({
      companyId: "company-1",
      githubIssues: [
        {
          title: "Fix the widget",
          body: "It is broken.",
          labels: [{ name: "bug" }, { name: "priority:high" }],
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ priority: "high", title: "Fix the widget" });
  });
});
