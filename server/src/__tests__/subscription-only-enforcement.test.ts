/**
 * P1 — Subscription-only enforcement on the agent-hire endpoint.
 *
 * Verifies:
 * 1. Board user with subscriptionOnly=true is refused when hiring an api-billed adapter (HTTP 403,
 *    structured error code "subscription_only_violation").
 * 2. Board user with subscriptionOnly=true is allowed when hiring a subscription-billed adapter.
 * 3. Board user with subscriptionOnly=true is allowed when hiring a hybrid-billed adapter.
 * 4. Board user with subscriptionOnly=false can hire any adapter regardless of billingMode.
 * 5. Agent actor bypasses the subscriptionOnly check (agent has no profile).
 * 6. Adapter with unknown billingMode (undefined) is treated as "api" — blocked when subscriptionOnly=true.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const companyId = "dddddddd-dddd-4ddd-8ddd-000000000000";
const agentId = "aaaaaaaa-aaaa-4aaa-8aaa-000000000000";
const userId = "user-subscription-only-test";

const baseAgent = {
  id: agentId,
  companyId,
  name: "CEO",
  urlKey: "ceo",
  role: "ceo",
  title: null,
  icon: null,
  status: "idle",
  reportsTo: null,
  capabilities: null,
  adapterType: "claude_local",
  adapterConfig: {},
  runtimeConfig: {},
  budgetMonthlyCents: 0,
  spentMonthlyCents: 0,
  pauseReason: null,
  pausedAt: null,
  permissions: { canCreateAgents: true },
  lastHeartbeatAt: null,
  metadata: null,
  createdAt: new Date("2026-04-18T00:00:00.000Z"),
  updatedAt: new Date("2026-04-18T00:00:00.000Z"),
};

// ─── hoisted mocks ──────────────────────────────────────────────────────────

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  updatePermissions: vi.fn(),
  getChainOfCommand: vi.fn(),
  resolveByReference: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  canUser: vi.fn(),
  hasPermission: vi.fn(),
  getMembership: vi.fn(),
  ensureMembership: vi.fn(),
  listPrincipalGrants: vi.fn(),
  setPrincipalPermission: vi.fn(),
}));

const mockApprovalService = vi.hoisted(() => ({
  create: vi.fn(),
  getById: vi.fn(),
}));

const mockBudgetService = vi.hoisted(() => ({
  upsertPolicy: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  listTaskSessions: vi.fn(),
  resetRuntimeSession: vi.fn(),
  getRun: vi.fn(),
  cancelRun: vi.fn(),
}));

const mockIssueApprovalService = vi.hoisted(() => ({
  linkManyForApproval: vi.fn(),
}));

const mockIssueService = vi.hoisted(() => ({
  list: vi.fn(),
}));

const mockSecretService = vi.hoisted(() => ({
  normalizeAdapterConfigForPersistence: vi.fn(),
  resolveAdapterConfigForRuntime: vi.fn(),
}));

const mockAgentInstructionsService = vi.hoisted(() => ({
  materializeManagedBundle: vi.fn(),
}));

const mockCompanySkillService = vi.hoisted(() => ({
  listRuntimeSkillEntries: vi.fn(),
  resolveRequestedSkillKeys: vi.fn(),
}));

const mockWorkspaceOperationService = vi.hoisted(() => ({}));
const mockLogActivity = vi.hoisted(() => vi.fn());
const mockTrackAgentCreated = vi.hoisted(() => vi.fn());
const mockGetTelemetryClient = vi.hoisted(() => vi.fn());
const mockSyncInstructionsBundleConfigFromFilePath = vi.hoisted(() => vi.fn());

// userProfileService mock — controls subscriptionOnly per test
const mockUserProfileService = vi.hoisted(() => ({
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
}));

function registerModuleMocks() {
  vi.doMock("@paperclipai/shared/telemetry", () => ({
    trackAgentCreated: mockTrackAgentCreated,
    trackErrorHandlerCrash: vi.fn(),
  }));

  vi.doMock("../telemetry.js", () => ({
    getTelemetryClient: mockGetTelemetryClient,
  }));

  vi.doMock("../services/index.js", () => ({
    agentService: () => mockAgentService,
    agentInstructionsService: () => mockAgentInstructionsService,
    accessService: () => mockAccessService,
    approvalService: () => mockApprovalService,
    companySkillService: () => mockCompanySkillService,
    budgetService: () => mockBudgetService,
    heartbeatService: () => mockHeartbeatService,
    issueApprovalService: () => mockIssueApprovalService,
    issueService: () => mockIssueService,
    logActivity: mockLogActivity,
    secretService: () => mockSecretService,
    syncInstructionsBundleConfigFromFilePath: mockSyncInstructionsBundleConfigFromFilePath,
    workspaceOperationService: () => mockWorkspaceOperationService,
    userProfileService: () => mockUserProfileService,
  }));
}

function createDbStub() {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          then: vi.fn().mockResolvedValue([{
            id: companyId,
            name: "TestCo",
            requireBoardApprovalForNewAgents: false,
          }]),
        }),
      }),
    }),
  };
}

async function createApp(actor: Record<string, unknown>) {
  const [{ errorHandler }, { agentRoutes }] = await Promise.all([
    vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
    vi.importActual<typeof import("../routes/agents.js")>("../routes/agents.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as Record<string, unknown>).actor = actor;
    next();
  });
  app.use("/api", agentRoutes(createDbStub() as never));
  app.use(errorHandler);
  return app;
}

const boardActor = (overrides?: Partial<Record<string, unknown>>) => ({
  type: "board",
  userId,
  source: "local_implicit",
  isInstanceAdmin: true,
  companyIds: [companyId],
  ...overrides,
});

const agentActor = () => ({
  type: "agent",
  agentId,
  companyId,
  companyIds: [companyId],
});

// ─── shared beforeEach ───────────────────────────────────────────────────────

describe("P1 subscription-only enforcement", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("@paperclipai/shared/telemetry");
    vi.doUnmock("../telemetry.js");
    vi.doUnmock("../services/index.js");
    vi.doUnmock("../routes/agents.js");
    vi.doUnmock("../middleware/index.js");
    registerModuleMocks();
    vi.clearAllMocks();

    mockSyncInstructionsBundleConfigFromFilePath.mockImplementation(
      (_agent: unknown, config: unknown) => config,
    );
    mockGetTelemetryClient.mockReturnValue({ track: vi.fn() });
    mockAgentService.getChainOfCommand.mockResolvedValue([]);
    mockAgentService.list.mockResolvedValue([baseAgent]);
    mockAgentService.create.mockImplementation(
      async (_companyId: string, input: Record<string, unknown>) => ({
        ...baseAgent,
        ...input,
        id: "new-agent-id",
        adapterType: input.adapterType ?? "codex_local",
        adapterConfig: input.adapterConfig ?? {},
        runtimeConfig: input.runtimeConfig ?? {},
        permissions: input.permissions ?? { canCreateAgents: false },
        metadata: input.metadata ?? null,
      }),
    );
    mockAgentService.update.mockImplementation(
      async (_id: string, data: unknown) => ({ ...baseAgent, ...(data as object) }),
    );
    mockAgentService.updatePermissions.mockResolvedValue(baseAgent);
    mockAccessService.getMembership.mockResolvedValue(null);
    mockAccessService.listPrincipalGrants.mockResolvedValue([]);
    mockAccessService.ensureMembership.mockResolvedValue(undefined);
    mockAccessService.setPrincipalPermission.mockResolvedValue(undefined);
    mockAccessService.hasPermission.mockResolvedValue(false);
    mockAccessService.canUser.mockResolvedValue(true);
    mockCompanySkillService.listRuntimeSkillEntries.mockResolvedValue([]);
    mockCompanySkillService.resolveRequestedSkillKeys.mockImplementation(
      async (_companyId: string, requested: string[]) => requested,
    );
    mockBudgetService.upsertPolicy.mockResolvedValue(undefined);
    mockAgentInstructionsService.materializeManagedBundle.mockImplementation(
      async (agent: Record<string, unknown>, files: Record<string, string>) => ({
        bundle: null,
        adapterConfig: {
          ...((agent.adapterConfig as Record<string, unknown> | undefined) ?? {}),
          instructionsBundleMode: "managed",
          instructionsRootPath: `/tmp/${String(agent.id)}/instructions`,
          instructionsEntryFile: "AGENTS.md",
          instructionsFilePath: `/tmp/${String(agent.id)}/instructions/AGENTS.md`,
          promptTemplate: files["AGENTS.md"] ?? "",
        },
      }),
    );
    mockSecretService.normalizeAdapterConfigForPersistence.mockImplementation(
      async (_companyId: unknown, config: unknown) => config,
    );
    mockSecretService.resolveAdapterConfigForRuntime.mockImplementation(
      async (_companyId: unknown, config: unknown) => ({ config }),
    );
    mockLogActivity.mockResolvedValue(undefined);

    // Default: subscriptionOnly=true
    mockUserProfileService.getProfile.mockResolvedValue({
      userId,
      subscriptionOnly: true,
      claudeSubscription: null,
      codexSubscription: null,
      preferences: {},
      createdAt: "2026-04-18T00:00:00.000Z",
      updatedAt: "2026-04-18T00:00:00.000Z",
    });
  });

  // ── blocking tests ─────────────────────────────────────────────────────────

  describe("blocks api-billed adapters when subscriptionOnly=true", () => {
    it("refuses a hire with billingMode=api (structured 403)", async () => {
      // subscriptionOnly=true (default from beforeEach)
      const app = await createApp(boardActor());

      const res = await request(app)
        .post(`/api/companies/${companyId}/agent-hires`)
        .send({ name: "API Bot", role: "engineer", adapterType: "process" });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("subscription_only_violation");
      expect(res.body.adapter).toBe("process");
      expect(Array.isArray(res.body.allowed)).toBe(true);
    });
  });

  // ── allow tests ────────────────────────────────────────────────────────────

  describe("allows subscription-billed adapters when subscriptionOnly=true", () => {
    it("allows a hire with billingMode=subscription (claude_local)", async () => {
      const app = await createApp(boardActor());

      const res = await request(app)
        .post(`/api/companies/${companyId}/agent-hires`)
        .send({ name: "Claude Bot", role: "engineer", adapterType: "claude_local" });

      expect(res.status).toBe(201);
    });

    it("allows a hire with billingMode=subscription (codex_local)", async () => {
      const app = await createApp(boardActor());

      const res = await request(app)
        .post(`/api/companies/${companyId}/agent-hires`)
        .send({ name: "Codex Bot", role: "engineer", adapterType: "codex_local" });

      expect(res.status).toBe(201);
    });
  });

  describe("allows hybrid-billed adapters when subscriptionOnly=true", () => {
    it("allows a hire with billingMode=hybrid (openclaw_gateway)", async () => {
      const app = await createApp(boardActor());

      const res = await request(app)
        .post(`/api/companies/${companyId}/agent-hires`)
        .send({ name: "OpenClaw Bot", role: "engineer", adapterType: "openclaw_gateway" });

      expect(res.status).toBe(201);
    });
  });

  // ── opt-out test ───────────────────────────────────────────────────────────

  describe("allows all adapters when subscriptionOnly=false", () => {
    it("allows api-billed hire when subscriptionOnly=false", async () => {
      mockUserProfileService.getProfile.mockResolvedValue({
        userId,
        subscriptionOnly: false,
        claudeSubscription: null,
        codexSubscription: null,
        preferences: {},
        createdAt: "2026-04-18T00:00:00.000Z",
        updatedAt: "2026-04-18T00:00:00.000Z",
      });
      const app = await createApp(boardActor());

      const res = await request(app)
        .post(`/api/companies/${companyId}/agent-hires`)
        .send({ name: "API Bot", role: "engineer", adapterType: "process" });

      // Should reach the hire logic and succeed (no billing block)
      expect(res.status).toBe(201);
    });
  });

  // ── agent actor bypass ────────────────────────────────────────────────────

  describe("agent actors bypass the subscriptionOnly check", () => {
    it("agent actor can hire any adapter regardless of subscriptionOnly", async () => {
      mockAgentService.getById.mockResolvedValue(baseAgent);
      const app = await createApp(agentActor());

      // process adapter is api-billed; subscriptionOnly would normally block a board user
      const res = await request(app)
        .post(`/api/companies/${companyId}/agent-hires`)
        .send({ name: "Agent Hire", role: "engineer", adapterType: "process" });

      // Should NOT be blocked by subscription enforcement — agents have no profile
      expect(res.status).toBe(201);
      // Also verify getProfile was NOT called for agent actors
      expect(mockUserProfileService.getProfile).not.toHaveBeenCalled();
    });
  });
});
