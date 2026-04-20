/**
 * Tests that the CEO's heartbeat context includes a COVERAGE ALERT block when
 * there are uncovered area labels, and that non-CEO agents never see it.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UncoveredLabel } from "../routes/company-coverage.js";

// ---------------------------------------------------------------------------
// Mock buildCoverageSummary so tests control what "uncovered labels" look like
// ---------------------------------------------------------------------------

const mockBuildCoverageSummary = vi.hoisted(() => vi.fn<() => Promise<UncoveredLabel[]>>());

vi.mock("../routes/company-coverage.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../routes/company-coverage.js")>();
  return {
    ...actual,
    buildCoverageSummary: mockBuildCoverageSummary,
  };
});

// ---------------------------------------------------------------------------
// Mock service layer
// ---------------------------------------------------------------------------

const mockAgentGetById = vi.hoisted(() => vi.fn());
const mockIssueService = vi.hoisted(() => ({
  getById: vi.fn(),
  getAncestors: vi.fn(),
  getRelationSummaries: vi.fn(),
  findMentionedProjectIds: vi.fn(),
  getCommentCursor: vi.fn(),
  getComment: vi.fn(),
  listAttachments: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  accessService: () => ({
    canUser: vi.fn(),
    hasPermission: vi.fn(),
  }),
  agentService: () => ({
    getById: mockAgentGetById,
  }),
  documentService: () => ({
    getIssueDocumentPayload: vi.fn(async () => ({})),
    getIssueDocumentByKey: vi.fn(async () => null),
  }),
  executionWorkspaceService: () => ({
    getById: vi.fn(),
  }),
  feedbackService: () => ({
    listIssueVotesForUser: vi.fn(async () => []),
    saveIssueVote: vi.fn(async () => ({ vote: null, consentEnabledNow: false, sharingEnabled: false })),
  }),
  goalService: () => ({
    getById: vi.fn(async () => null),
    getDefaultCompanyGoal: vi.fn(async () => null),
  }),
  heartbeatService: () => ({
    wakeup: vi.fn(async () => undefined),
    reportRunActivity: vi.fn(async () => undefined),
  }),
  instanceSettingsService: () => ({
    get: vi.fn(async () => ({
      id: "instance-settings-1",
      general: {
        censorUsernameInLogs: false,
        feedbackDataSharingPreference: "prompt",
      },
    })),
    listCompanyIds: vi.fn(async () => ["company-1"]),
  }),
  issueApprovalService: () => ({}),
  issueService: () => mockIssueService,
  logActivity: vi.fn(async () => undefined),
  projectService: () => ({
    getById: vi.fn(async () => null),
    listByIds: vi.fn(async () => []),
  }),
  routineService: () => ({
    syncRunStatusForIssue: vi.fn(async () => undefined),
  }),
  workProductService: () => ({
    listForIssue: vi.fn(async () => []),
  }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ISSUE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CEO_AGENT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ENG_AGENT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const baseIssue = {
  id: ISSUE_ID,
  companyId: "company-1",
  identifier: "PAP-1",
  title: "CEO planning issue",
  description: null,
  status: "todo" as const,
  priority: "medium" as const,
  projectId: null,
  goalId: null,
  parentId: null,
  assigneeAgentId: CEO_AGENT_ID,
  assigneeUserId: null,
  updatedAt: new Date("2026-04-20T00:00:00Z"),
  executionWorkspaceId: null,
  labels: [],
  labelIds: [],
};

const ceoAgent = {
  id: CEO_AGENT_ID,
  companyId: "company-1",
  role: "ceo",
  name: "CEO",
  status: "active",
};

const engineerAgent = {
  id: ENG_AGENT_ID,
  companyId: "company-1",
  role: "software_engineer",
  name: "Engineer",
  status: "active",
};

const uncoveredLabels: UncoveredLabel[] = [
  { label: "area:email", issueCount: 7, suggestedProfile: "coding-heavy" },
  { label: "area:campaigns", issueCount: 4, suggestedProfile: "coding-heavy" },
  { label: "area:graph-api", issueCount: 2, suggestedProfile: "coding-heavy" },
];

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

async function createApp(actorAgentId: string | null = null) {
  const [{ issueRoutes }, { errorHandler }] = await Promise.all([
    vi.importActual<typeof import("../routes/issues.js")>("../routes/issues.js"),
    vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (actorAgentId) {
      (req as any).actor = {
        type: "agent",
        agentId: actorAgentId,
        companyId: "company-1",
        runId: null,
      };
    } else {
      (req as any).actor = {
        type: "board",
        userId: "local-board",
        companyIds: ["company-1"],
        source: "local_implicit",
        isInstanceAdmin: false,
      };
    }
    next();
  });
  app.use("/api", issueRoutes({} as any, {} as any));
  app.use(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("heartbeat-context coverage injection", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("../routes/issues.js");
    vi.doUnmock("../routes/authz.js");
    vi.doUnmock("../middleware/index.js");
    vi.resetAllMocks();

    mockIssueService.getById.mockResolvedValue(baseIssue);
    mockIssueService.getAncestors.mockResolvedValue([]);
    mockIssueService.getRelationSummaries.mockResolvedValue({ blockedBy: [], blocks: [] });
    mockIssueService.getCommentCursor.mockResolvedValue({
      totalComments: 0,
      latestCommentId: null,
      latestCommentAt: null,
    });
    mockIssueService.getComment.mockResolvedValue(null);
    mockIssueService.listAttachments.mockResolvedValue([]);
  });

  it("CEO with uncovered labels receives COVERAGE ALERT in heartbeat context", async () => {
    mockAgentGetById.mockResolvedValue(ceoAgent);
    mockBuildCoverageSummary.mockResolvedValue(uncoveredLabels);

    const app = await createApp(CEO_AGENT_ID);
    const res = await request(app).get(`/api/issues/${ISSUE_ID}/heartbeat-context`);

    expect(res.status).toBe(200);
    expect(res.body.coverageAlert).toBeDefined();
    expect(res.body.coverageAlert).toContain("COVERAGE ALERT");
    expect(res.body.coverageAlert).toContain("area:email");
    expect(res.body.coverageAlert).toContain("area:campaigns");
    expect(res.body.coverageAlert).toContain("area:graph-api");
    expect(res.body.coverageAlert).toContain("paperclipHireWithProfile");
    expect(mockBuildCoverageSummary).toHaveBeenCalledWith(expect.anything(), "company-1");
  });

  it("CEO with full coverage does NOT receive the COVERAGE ALERT block", async () => {
    mockAgentGetById.mockResolvedValue(ceoAgent);
    mockBuildCoverageSummary.mockResolvedValue([]);

    const app = await createApp(CEO_AGENT_ID);
    const res = await request(app).get(`/api/issues/${ISSUE_ID}/heartbeat-context`);

    expect(res.status).toBe(200);
    expect(res.body.coverageAlert).toBeUndefined();
    expect(mockBuildCoverageSummary).toHaveBeenCalled();
  });

  it("non-CEO agent never receives the coverage block even with uncovered labels", async () => {
    mockAgentGetById.mockResolvedValue(engineerAgent);
    // buildCoverageSummary should NOT be called for non-CEO agents
    mockBuildCoverageSummary.mockResolvedValue(uncoveredLabels);

    const app = await createApp(ENG_AGENT_ID);
    const res = await request(app).get(`/api/issues/${ISSUE_ID}/heartbeat-context`);

    expect(res.status).toBe(200);
    expect(res.body.coverageAlert).toBeUndefined();
    expect(mockBuildCoverageSummary).not.toHaveBeenCalled();
  });

  it("board (non-agent) requester never receives the coverage block", async () => {
    mockBuildCoverageSummary.mockResolvedValue(uncoveredLabels);

    // Pass null → board actor, no agentId
    const app = await createApp(null);
    const res = await request(app).get(`/api/issues/${ISSUE_ID}/heartbeat-context`);

    expect(res.status).toBe(200);
    expect(res.body.coverageAlert).toBeUndefined();
    expect(mockBuildCoverageSummary).not.toHaveBeenCalled();
  });

  it("coverage alert lists the top uncovered label name in the block", async () => {
    mockAgentGetById.mockResolvedValue(ceoAgent);
    mockBuildCoverageSummary.mockResolvedValue([
      { label: "area:email", issueCount: 7, suggestedProfile: "coding-heavy" },
    ]);

    const app = await createApp(CEO_AGENT_ID);
    const res = await request(app).get(`/api/issues/${ISSUE_ID}/heartbeat-context`);

    expect(res.status).toBe(200);
    expect(res.body.coverageAlert).toContain("area:email");
    expect(res.body.coverageAlert).toContain("7 issues");
  });
});
