import express, { type Request } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockIssueService = vi.hoisted(() => ({
  getById: vi.fn(),
  assertCheckoutOwner: vi.fn(),
  update: vi.fn(),
  addComment: vi.fn(),
  findMentionedAgents: vi.fn(),
  getRelationSummaries: vi.fn(),
  listWakeableBlockedDependents: vi.fn(),
  getWakeableParentAfterChildCompletion: vi.fn(),
  releaseStaleExecutionLock: vi.fn(),
  forceReleaseExecutionLock: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  wakeup: vi.fn(async () => undefined),
  reportRunActivity: vi.fn(async () => undefined),
  getRun: vi.fn(async () => null),
  getActiveRunForAgent: vi.fn(async () => null),
  cancelRun: vi.fn(async () => null),
}));

const mockLogActivity = vi.hoisted(() => vi.fn(async () => undefined));

function registerModuleMocks() {
  vi.doMock("../services/index.js", () => ({
    accessService: () => ({
      canUser: vi.fn(async () => false),
      hasPermission: vi.fn(async () => false),
    }),
    agentService: () => ({
      getById: vi.fn(async () => null),
    }),
    documentService: () => ({}),
    executionWorkspaceService: () => ({}),
    feedbackService: () => ({
      listIssueVotesForUser: vi.fn(async () => []),
      saveIssueVote: vi.fn(async () => ({ vote: null, consentEnabledNow: false, sharingEnabled: false })),
    }),
    goalService: () => ({}),
    heartbeatService: () => mockHeartbeatService,
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
    logActivity: mockLogActivity,
    projectService: () => ({}),
    routineService: () => ({
      syncRunStatusForIssue: vi.fn(async () => undefined),
    }),
    workProductService: () => ({}),
  }));
}

type ActorOverride = Partial<Request["actor"]> | null;

async function createApp(actor: ActorOverride = null) {
  const [{ errorHandler }, { issueRoutes }] = await Promise.all([
    import("../middleware/index.js"),
    import("../routes/issues.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor =
      actor ?? {
        type: "board",
        userId: "local-board",
        companyIds: ["company-1"],
        source: "local_implicit",
        isInstanceAdmin: false,
      };
    next();
  });
  app.use("/api", issueRoutes({} as any, {} as any));
  app.use(errorHandler);
  return app;
}

const ISSUE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY_ID = "company-1";

const baseIssue = {
  id: ISSUE_ID,
  companyId: COMPANY_ID,
  status: "in_progress",
  assigneeAgentId: null,
  assigneeUserId: null,
  createdByUserId: "local-board",
  identifier: "PAP-1",
  title: "Wedged issue",
  executionPolicy: null,
  executionState: null,
};

describe("issue execution lock recovery routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("../services/index.js");
    vi.doUnmock("../routes/issues.js");
    vi.doUnmock("../middleware/index.js");
    registerModuleMocks();
    vi.clearAllMocks();
    mockIssueService.assertCheckoutOwner.mockResolvedValue({ adoptedFromRunId: null });
    mockIssueService.findMentionedAgents.mockResolvedValue([]);
    mockIssueService.getRelationSummaries.mockResolvedValue({ blockedBy: [], blocks: [] });
    mockIssueService.listWakeableBlockedDependents.mockResolvedValue([]);
    mockIssueService.getWakeableParentAfterChildCompletion.mockResolvedValue(null);
    mockIssueService.getById.mockResolvedValue(baseIssue);
  });

  describe("POST /api/issues/:id/execution-lock/release-stale", () => {
    it("returns 200 and audit-logs when a terminal-run lock is released", async () => {
      mockIssueService.releaseStaleExecutionLock.mockResolvedValue({
        status: "released",
        issueId: ISSUE_ID,
        companyId: COMPANY_ID,
        previousExecutionRunId: "prev-run",
        previousExecutionAgentNameKey: "codexcoder",
        previousExecutionLockedAt: new Date("2026-04-01T12:00:00.000Z"),
        runStatus: "failed",
        runAgentId: "agent-1",
        reason: "run_terminal",
      });

      const res = await request(await createApp())
        .post(`/api/issues/${ISSUE_ID}/execution-lock/release-stale`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.released).toBe(true);
      expect(res.body.reason).toBe("run_terminal");
      expect(res.body.previousExecutionRunId).toBe("prev-run");
      expect(mockIssueService.releaseStaleExecutionLock).toHaveBeenCalledWith(ISSUE_ID);
      expect(mockLogActivity).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: "issue.execution_lock_released_stale",
          entityType: "issue",
          entityId: ISSUE_ID,
          companyId: COMPANY_ID,
        }),
      );
    });

    it("returns 409 when the lock is still held by an active run", async () => {
      mockIssueService.releaseStaleExecutionLock.mockResolvedValue({
        status: "active",
        issueId: ISSUE_ID,
        companyId: COMPANY_ID,
        executionRunId: "run-1",
        runStatus: "running",
        runAgentId: "agent-1",
      });

      const res = await request(await createApp())
        .post(`/api/issues/${ISSUE_ID}/execution-lock/release-stale`)
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.executionRunId).toBe("run-1");
      expect(res.body.runStatus).toBe("running");
      expect(mockLogActivity).not.toHaveBeenCalled();
    });

    it("returns 200 with no_lock when the issue has no execution lock", async () => {
      mockIssueService.releaseStaleExecutionLock.mockResolvedValue({
        status: "no_lock",
        issueId: ISSUE_ID,
        companyId: COMPANY_ID,
      });

      const res = await request(await createApp())
        .post(`/api/issues/${ISSUE_ID}/execution-lock/release-stale`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ released: false, reason: "no_lock" });
      expect(mockLogActivity).not.toHaveBeenCalled();
    });

    it("returns 404 when the issue does not exist", async () => {
      mockIssueService.getById.mockResolvedValue(null);

      const res = await request(await createApp())
        .post(`/api/issues/${ISSUE_ID}/execution-lock/release-stale`)
        .send({});

      expect(res.status).toBe(404);
    });

    it("rejects callers without company access", async () => {
      const res = await request(
        await createApp({
          type: "board",
          userId: "other-user",
          companyIds: ["other-company"],
          source: "jwt",
          isInstanceAdmin: false,
          memberships: [],
        } as unknown as Request["actor"]),
      )
        .post(`/api/issues/${ISSUE_ID}/execution-lock/release-stale`)
        .send({});

      expect(res.status).toBe(403);
      expect(mockIssueService.releaseStaleExecutionLock).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/issues/:id/execution-lock/force-release", () => {
    it("force-releases the lock for a board caller and audit-logs the reason note", async () => {
      mockIssueService.forceReleaseExecutionLock.mockResolvedValue({
        status: "released",
        issueId: ISSUE_ID,
        companyId: COMPANY_ID,
        previousExecutionRunId: "prev-run",
        previousExecutionAgentNameKey: "codexcoder",
        previousExecutionLockedAt: new Date("2026-04-01T12:00:00.000Z"),
        runStatus: "running",
        runAgentId: "agent-1",
        runWasActive: true,
      });

      const res = await request(await createApp())
        .post(`/api/issues/${ISSUE_ID}/execution-lock/force-release`)
        .send({ reason: "Orphaned queued run after agent crash" });

      expect(res.status).toBe(200);
      expect(res.body.released).toBe(true);
      expect(res.body.previousExecutionRunId).toBe("prev-run");
      expect(res.body.runWasActive).toBe(true);
      expect(mockIssueService.forceReleaseExecutionLock).toHaveBeenCalledWith(ISSUE_ID);
      expect(mockLogActivity).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: "issue.execution_lock_force_released",
          entityType: "issue",
          entityId: ISSUE_ID,
          companyId: COMPANY_ID,
          details: expect.objectContaining({
            previousExecutionRunId: "prev-run",
            runStatus: "running",
            runWasActive: true,
            reasonNote: "Orphaned queued run after agent crash",
          }),
        }),
      );
    });

    it("rejects non-board callers with 403", async () => {
      const res = await request(
        await createApp({
          type: "agent",
          agentId: "agent-1",
          companyId: COMPANY_ID,
          runId: null,
        } as unknown as Request["actor"]),
      )
        .post(`/api/issues/${ISSUE_ID}/execution-lock/force-release`)
        .send({});

      expect(res.status).toBe(403);
      expect(mockIssueService.forceReleaseExecutionLock).not.toHaveBeenCalled();
      expect(mockLogActivity).not.toHaveBeenCalled();
    });

    it("rejects unauthenticated callers", async () => {
      const res = await request(
        await createApp({
          type: "none",
        } as unknown as Request["actor"]),
      )
        .post(`/api/issues/${ISSUE_ID}/execution-lock/force-release`)
        .send({});

      expect(res.status).toBe(401);
      expect(mockIssueService.forceReleaseExecutionLock).not.toHaveBeenCalled();
    });

    it("returns 200 with no_lock when the issue has no execution lock", async () => {
      mockIssueService.forceReleaseExecutionLock.mockResolvedValue({
        status: "no_lock",
        issueId: ISSUE_ID,
        companyId: COMPANY_ID,
      });

      const res = await request(await createApp())
        .post(`/api/issues/${ISSUE_ID}/execution-lock/force-release`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ released: false, reason: "no_lock" });
      expect(mockLogActivity).not.toHaveBeenCalled();
    });

    it("returns 404 when the issue does not exist", async () => {
      mockIssueService.getById.mockResolvedValue(null);

      const res = await request(await createApp())
        .post(`/api/issues/${ISSUE_ID}/execution-lock/force-release`)
        .send({});

      expect(res.status).toBe(404);
    });
  });
});
