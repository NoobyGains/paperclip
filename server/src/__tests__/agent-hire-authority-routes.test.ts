/**
 * Layer 5 — route-level tests for hiring-authority cascade on agent-hire.
 *
 * Verifies:
 * 1. Lead-role hires get canCreateAgents=true auto-granted.
 * 2. Non-board agent can only hire into their own subtree.
 * 3. New hire's budget cannot exceed hirer's remaining budget.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ceoId = "aaaaaaaa-aaaa-4aaa-8aaa-000000000000";
const leadId = "bbbbbbbb-bbbb-4bbb-8bbb-000000000000";
const outsiderId = "cccccccc-cccc-4ccc-8ccc-000000000000";
const companyId = "dddddddd-dddd-4ddd-8ddd-000000000000";

const ceoAgent = {
  id: ceoId,
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
  budgetMonthlyCents: 10000,
  spentMonthlyCents: 2000,
  pauseReason: null,
  pausedAt: null,
  permissions: { canCreateAgents: true },
  lastHeartbeatAt: null,
  metadata: null,
  createdAt: new Date("2026-04-18T00:00:00.000Z"),
  updatedAt: new Date("2026-04-18T00:00:00.000Z"),
};

const leadAgent = {
  ...ceoAgent,
  id: leadId,
  name: "Lead",
  urlKey: "lead",
  role: "cto",
  reportsTo: ceoId,
  budgetMonthlyCents: 5000,
  spentMonthlyCents: 1000,
};

const outsiderAgent = {
  ...ceoAgent,
  id: outsiderId,
  name: "Outsider",
  urlKey: "outsider",
  role: "engineer",
  reportsTo: null,
};

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
    (req as any).actor = actor;
    next();
  });
  app.use("/api", agentRoutes(createDbStub() as any));
  app.use(errorHandler);
  return app;
}

const agentActor = (agentId: string) => ({
  type: "agent",
  agentId,
  companyId,
  companyIds: [companyId],
});

describe("L5 hiring-authority cascade", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("@paperclipai/shared/telemetry");
    vi.doUnmock("../telemetry.js");
    vi.doUnmock("../services/index.js");
    vi.doUnmock("../routes/agents.js");
    vi.doUnmock("../middleware/index.js");
    registerModuleMocks();
    vi.clearAllMocks();

    mockSyncInstructionsBundleConfigFromFilePath.mockImplementation((_agent: unknown, config: unknown) => config);
    mockGetTelemetryClient.mockReturnValue({ track: vi.fn() });
    mockAgentService.getChainOfCommand.mockResolvedValue([]);
    mockAgentService.list.mockResolvedValue([ceoAgent, leadAgent, outsiderAgent]);
    mockAgentService.create.mockImplementation(async (_companyId: string, input: Record<string, unknown>) => ({
      ...ceoAgent,
      ...input,
      id: "new-agent-id",
      adapterType: input.adapterType ?? "codex_local",
      adapterConfig: input.adapterConfig ?? {},
      runtimeConfig: input.runtimeConfig ?? {},
      permissions: input.permissions ?? { canCreateAgents: false },
      metadata: input.metadata ?? null,
    }));
    mockAgentService.update.mockImplementation(async (_id: string, data: unknown) => ({ ...ceoAgent, ...data as object }));
    mockAgentService.updatePermissions.mockResolvedValue(ceoAgent);
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
  });

  describe("auto-grant canCreateAgents for lead roles", () => {
    it("grants canCreateAgents=true when hiring a cto", async () => {
      mockAgentService.getById.mockResolvedValue(ceoAgent);
      const app = await createApp(agentActor(ceoId));

      const res = await request(app)
        .post(`/api/companies/${companyId}/agent-hires`)
        .send({ name: "New CTO", role: "cto", adapterType: "claude_local" });

      expect(res.status).toBe(201);
      expect(mockAgentService.create).toHaveBeenCalledWith(
        companyId,
        expect.objectContaining({
          permissions: expect.objectContaining({ canCreateAgents: true }),
        }),
      );
    });

    it("grants canCreateAgents=true when hiring a pm", async () => {
      mockAgentService.getById.mockResolvedValue(ceoAgent);
      const app = await createApp(agentActor(ceoId));

      const res = await request(app)
        .post(`/api/companies/${companyId}/agent-hires`)
        .send({ name: "New PM", role: "pm", adapterType: "codex_local" });

      expect(res.status).toBe(201);
      expect(mockAgentService.create).toHaveBeenCalledWith(
        companyId,
        expect.objectContaining({
          permissions: expect.objectContaining({ canCreateAgents: true }),
        }),
      );
    });

    it("does NOT grant canCreateAgents for worker role (engineer)", async () => {
      mockAgentService.getById.mockResolvedValue(ceoAgent);
      const app = await createApp(agentActor(ceoId));

      const res = await request(app)
        .post(`/api/companies/${companyId}/agent-hires`)
        .send({ name: "New Engineer", role: "engineer", adapterType: "codex_local" });

      expect(res.status).toBe(201);
      const createCall = mockAgentService.create.mock.calls[0];
      const storedInput = createCall?.[1] as Record<string, unknown>;
      const perms = storedInput?.permissions as Record<string, unknown> | undefined;
      expect(perms?.canCreateAgents).not.toBe(true);
    });
  });

  describe("reportsTo subtree containment", () => {
    it("allows hiring directly under the hirer (hirer === reportsTo)", async () => {
      mockAgentService.getById.mockResolvedValue(ceoAgent);
      const app = await createApp(agentActor(ceoId));

      const res = await request(app)
        .post(`/api/companies/${companyId}/agent-hires`)
        .send({ name: "Direct Report", role: "engineer", adapterType: "codex_local", reportsTo: ceoId });

      expect(res.status).toBe(201);
    });

    it("allows hiring into own subtree (reportsTo is a descendant of hirer)", async () => {
      mockAgentService.getById.mockResolvedValue(ceoAgent);
      const app = await createApp(agentActor(ceoId));

      // leadId is a direct report of ceoId, so it's in CEO's subtree
      const res = await request(app)
        .post(`/api/companies/${companyId}/agent-hires`)
        .send({ name: "Sub Report", role: "engineer", adapterType: "codex_local", reportsTo: leadId });

      expect(res.status).toBe(201);
    });

    it("rejects hire outside the hirer's subtree with 403", async () => {
      // leadAgent tries to hire someone reporting to outsiderAgent (not in lead's subtree)
      mockAgentService.getById.mockResolvedValue(leadAgent);
      const app = await createApp(agentActor(leadId));

      const res = await request(app)
        .post(`/api/companies/${companyId}/agent-hires`)
        .send({ name: "Hijacked Report", role: "engineer", adapterType: "codex_local", reportsTo: outsiderId });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/subtree/i);
    });
  });

  describe("budget inheritance", () => {
    it("allows hire when budget is within hirer's remaining budget", async () => {
      mockAgentService.getById.mockResolvedValue(ceoAgent);
      // CEO has 10000 - 2000 = 8000 remaining
      const app = await createApp(agentActor(ceoId));

      const res = await request(app)
        .post(`/api/companies/${companyId}/agent-hires`)
        .send({ name: "Cheap Bot", role: "engineer", adapterType: "codex_local", budgetMonthlyCents: 5000 });

      expect(res.status).toBe(201);
    });

    it("rejects hire when budget exceeds hirer's remaining budget with 403", async () => {
      mockAgentService.getById.mockResolvedValue(ceoAgent);
      // CEO has 10000 - 2000 = 8000 remaining; requesting 9000 should fail
      const app = await createApp(agentActor(ceoId));

      const res = await request(app)
        .post(`/api/companies/${companyId}/agent-hires`)
        .send({ name: "Expensive Bot", role: "engineer", adapterType: "codex_local", budgetMonthlyCents: 9000 });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/budget/i);
    });

    it("allows hire with zero budget regardless of hirer remaining budget", async () => {
      const brokeCeo = { ...ceoAgent, budgetMonthlyCents: 0, spentMonthlyCents: 0 };
      mockAgentService.getById.mockResolvedValue(brokeCeo);
      const app = await createApp(agentActor(ceoId));

      const res = await request(app)
        .post(`/api/companies/${companyId}/agent-hires`)
        .send({ name: "Free Bot", role: "engineer", adapterType: "codex_local" });

      expect(res.status).toBe(201);
    });

    it("board actor bypasses budget check", async () => {
      const boardActor = {
        type: "board",
        userId: "admin-user",
        source: "local_implicit",
        isInstanceAdmin: true,
        companyIds: [companyId],
      };
      mockAgentService.getById.mockResolvedValue(ceoAgent);
      const app = await createApp(boardActor);

      // No hirerAgent for board, so budget check is skipped
      const res = await request(app)
        .post(`/api/companies/${companyId}/agent-hires`)
        .send({ name: "Board Hire", role: "engineer", adapterType: "codex_local", budgetMonthlyCents: 99999 });

      expect(res.status).toBe(201);
    });
  });
});
