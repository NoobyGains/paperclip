/**
 * Layer 3 — route-level tests for capabilities translation on agent-hire.
 *
 * Verifies that sending `hireCapabilities: { webSearch: true }` with a
 * codex_local hire results in the agent being created with
 * `adapterConfig.search === true`.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const agentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const companyId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const baseAgent = {
  id: agentId,
  companyId,
  name: "Code Bot",
  urlKey: "code-bot",
  role: "engineer",
  title: null,
  icon: null,
  status: "idle",
  reportsTo: null,
  capabilities: null,
  adapterType: "codex_local",
  adapterConfig: {},
  runtimeConfig: {},
  budgetMonthlyCents: 0,
  spentMonthlyCents: 0,
  pauseReason: null,
  pausedAt: null,
  permissions: { canCreateAgents: false },
  lastHeartbeatAt: null,
  metadata: null,
  createdAt: new Date("2026-04-18T00:00:00.000Z"),
  updatedAt: new Date("2026-04-18T00:00:00.000Z"),
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

const adminActor = {
  type: "board",
  userId: "admin-user",
  source: "local_implicit",
  isInstanceAdmin: true,
  companyIds: [companyId],
};

describe("capabilities translation on agent hire", () => {
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
    mockAgentService.getById.mockResolvedValue(baseAgent);
    mockAgentService.list.mockResolvedValue([baseAgent]);
    mockAgentService.getChainOfCommand.mockResolvedValue([]);
    mockAgentService.resolveByReference.mockResolvedValue({ ambiguous: false, agent: baseAgent });
    mockAgentService.create.mockImplementation(async (_companyId: string, input: Record<string, unknown>) => ({
      ...baseAgent,
      ...input,
      adapterType: input.adapterType ?? baseAgent.adapterType,
      adapterConfig: input.adapterConfig ?? {},
      runtimeConfig: input.runtimeConfig ?? {},
      permissions: input.permissions ?? baseAgent.permissions,
      metadata: input.metadata ?? null,
    }));
    mockAgentService.update.mockResolvedValue(baseAgent);
    mockAgentService.updatePermissions.mockResolvedValue(baseAgent);
    mockAccessService.getMembership.mockResolvedValue(null);
    mockAccessService.listPrincipalGrants.mockResolvedValue([]);
    mockAccessService.ensureMembership.mockResolvedValue(undefined);
    mockAccessService.setPrincipalPermission.mockResolvedValue(undefined);
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

  it("sets adapterConfig.search=true when hiring codex_local with hireCapabilities.webSearch=true", async () => {
    const app = await createApp(adminActor);

    const res = await request(app)
      .post(`/api/companies/${companyId}/agent-hires`)
      .send({
        name: "Search Bot",
        role: "engineer",
        adapterType: "codex_local",
        hireCapabilities: { webSearch: true },
      });

    expect(res.status).toBe(201);
    // Verify the agent was stored with search=true in adapterConfig.
    expect(mockAgentService.create).toHaveBeenCalledWith(
      companyId,
      expect.objectContaining({
        adapterConfig: expect.objectContaining({ search: true }),
      }),
    );
  });

  it("injects agent-browser skill when hiring codex_local with hireCapabilities.browser=true", async () => {
    const app = await createApp(adminActor);

    const res = await request(app)
      .post(`/api/companies/${companyId}/agent-hires`)
      .send({
        name: "Browser Bot",
        role: "engineer",
        adapterType: "codex_local",
        hireCapabilities: { browser: true },
      });

    expect(res.status).toBe(201);
    expect(mockAgentService.create).toHaveBeenCalledWith(
      companyId,
      expect.objectContaining({
        adapterConfig: expect.objectContaining({ search: true }),
      }),
    );
    // Verify that agent-browser skill was injected via desiredSkills processing.
    expect(mockCompanySkillService.resolveRequestedSkillKeys).toHaveBeenCalledWith(
      companyId,
      expect.arrayContaining(["vercel-labs/agent-browser/agent-browser"]),
    );
  });

  it("does NOT store hireCapabilities on the agent record", async () => {
    const app = await createApp(adminActor);

    await request(app)
      .post(`/api/companies/${companyId}/agent-hires`)
      .send({
        name: "Search Bot",
        role: "engineer",
        adapterType: "codex_local",
        hireCapabilities: { webSearch: true },
      });

    const createCall = mockAgentService.create.mock.calls[0];
    const storedInput = createCall?.[1] as Record<string, unknown> | undefined;
    expect(storedInput).not.toHaveProperty("hireCapabilities");
  });

  it("does not modify adapterConfig when no hireCapabilities provided", async () => {
    const app = await createApp(adminActor);

    await request(app)
      .post(`/api/companies/${companyId}/agent-hires`)
      .send({
        name: "Plain Bot",
        role: "engineer",
        adapterType: "codex_local",
        adapterConfig: { model: "gpt-4" },
      });

    expect(mockAgentService.create).toHaveBeenCalledWith(
      companyId,
      expect.objectContaining({
        adapterConfig: expect.not.objectContaining({ search: true }),
      }),
    );
  });

  it("injects web-search skill when hiring claude_local with hireCapabilities.webSearch=true", async () => {
    const app = await createApp(adminActor);

    await request(app)
      .post(`/api/companies/${companyId}/agent-hires`)
      .send({
        name: "Research Bot",
        role: "engineer",
        adapterType: "claude_local",
        hireCapabilities: { webSearch: true },
      });

    expect(mockCompanySkillService.resolveRequestedSkillKeys).toHaveBeenCalledWith(
      companyId,
      expect.arrayContaining(["paperclip-web-search"]),
    );
  });
});
