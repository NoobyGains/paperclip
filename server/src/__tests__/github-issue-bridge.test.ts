import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GithubIssue } from "../services/github-issue-bridge.js";
import { githubIssueBridge, parseGitHubRemoteUrl } from "../services/github-issue-bridge.js";

// --- helpers ---

const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY_ID = "11111111-1111-4111-8111-111111111111";

function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: PROJECT_ID,
    companyId: COMPANY_ID,
    primaryWorkspace: {
      id: "ws-1",
      cwd: "/repos/my-project",
      runtimeConfig: null,
    },
    ...overrides,
  };
}

function makeGhIssue(number: number, title: string): GithubIssue {
  return {
    number,
    title,
    body: "Body text",
    labels: [],
    url: `https://github.com/owner/repo/issues/${number}`,
  };
}

// --- tests ---

describe("parseGitHubRemoteUrl", () => {
  it("parses https github.com URLs", () => {
    expect(parseGitHubRemoteUrl("https://github.com/owner/repo.git")).toBe("owner/repo");
    expect(parseGitHubRemoteUrl("https://github.com/owner/repo")).toBe("owner/repo");
  });

  it("parses SSH SCP-style github.com URLs", () => {
    expect(parseGitHubRemoteUrl("git@github.com:owner/repo.git")).toBe("owner/repo");
  });

  it("returns null for non-GitHub hosts", () => {
    expect(parseGitHubRemoteUrl("https://gitlab.com/owner/repo.git")).toBeNull();
  });

  it("returns null for null/empty input", () => {
    expect(parseGitHubRemoteUrl(null)).toBeNull();
    expect(parseGitHubRemoteUrl("")).toBeNull();
  });
});

describe("githubIssueBridge.syncProject — projectId on created issues", () => {
  let mockIssueCreate: ReturnType<typeof vi.fn>;
  let mockProjectGetById: ReturnType<typeof vi.fn>;
  let mockAgentList: ReturnType<typeof vi.fn>;
  let mockExecGh: ReturnType<typeof vi.fn>;
  let mockDetectRepo: ReturnType<typeof vi.fn>;
  let mockDb: { select: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();

    mockIssueCreate = vi.fn();
    mockProjectGetById = vi.fn();
    mockAgentList = vi.fn().mockResolvedValue([
      { id: "ceo-1", role: "ceo", status: "active" },
    ]);
    mockExecGh = vi.fn();
    mockDetectRepo = vi.fn().mockResolvedValue("owner/repo");

    // db.select chain used for dedup query — returns empty set by default
    const mockSelectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };
    mockDb = {
      select: vi.fn().mockReturnValue(mockSelectChain),
    };

    // Each created issue echoes back the input so we can inspect it
    mockIssueCreate.mockImplementation(async (_companyId: string, data: Record<string, unknown>) => ({
      id: `issue-${Math.random()}`,
      ...data,
    }));
  });

  function makeBridge() {
    return githubIssueBridge(mockDb as any, {
      projectService: { getById: mockProjectGetById } as any,
      issueService: { create: mockIssueCreate } as any,
      agentService: { list: mockAgentList } as any,
      execGh: mockExecGh,
      detectGitHubRepo: mockDetectRepo,
    });
  }

  it("sets projectId on every created issue when syncing a project", async () => {
    mockProjectGetById.mockResolvedValue(makeProject());
    mockExecGh.mockResolvedValue([
      makeGhIssue(1, "First issue"),
      makeGhIssue(2, "Second issue"),
      makeGhIssue(3, "Third issue"),
    ]);

    const bridge = makeBridge();
    const result = await bridge.syncProject(PROJECT_ID);

    expect(result.imported).toBe(3);
    expect(mockIssueCreate).toHaveBeenCalledTimes(3);

    for (const call of mockIssueCreate.mock.calls) {
      const [, issueData] = call as [string, Record<string, unknown>];
      expect(issueData.projectId).toBe(PROJECT_ID);
    }
  });

  it("returns empty result when project has no workspace cwd", async () => {
    mockProjectGetById.mockResolvedValue(makeProject({ primaryWorkspace: null }));

    const bridge = makeBridge();
    const result = await bridge.syncProject(PROJECT_ID);

    expect(result.imported).toBe(0);
    expect(result.warnings).toContain("no workspace cwd; skipping");
    expect(mockIssueCreate).not.toHaveBeenCalled();
  });

  it("returns empty result when workspace has no GitHub remote", async () => {
    mockProjectGetById.mockResolvedValue(makeProject());
    mockDetectRepo.mockResolvedValue(null);

    const bridge = makeBridge();
    const result = await bridge.syncProject(PROJECT_ID);

    expect(result.imported).toBe(0);
    expect(result.warnings).toContain("workspace has no github.com remote");
    expect(mockIssueCreate).not.toHaveBeenCalled();
  });

  it("skips issues already mirrored (dedup by originId)", async () => {
    mockProjectGetById.mockResolvedValue(makeProject());

    // Simulate one already-mirrored issue in the DB
    const mockSelectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([
        { originKind: "github_issue", originId: "owner/repo#1" },
      ]),
    };
    mockDb.select = vi.fn().mockReturnValue(mockSelectChain);

    mockExecGh.mockResolvedValue([
      makeGhIssue(1, "Already mirrored"),
      makeGhIssue(2, "New issue"),
    ]);

    const bridge = makeBridge();
    const result = await bridge.syncProject(PROJECT_ID);

    expect(result.imported).toBe(1);
    expect(result.skippedAlreadyMirrored).toBe(1);
    expect(mockIssueCreate).toHaveBeenCalledTimes(1);

    const [, issueData] = mockIssueCreate.mock.calls[0] as [string, Record<string, unknown>];
    expect(issueData.projectId).toBe(PROJECT_ID);
  });
});
