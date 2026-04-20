import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- hoisted mocks ---

const mockProjectService = vi.hoisted(() => ({
  create: vi.fn(),
  getById: vi.fn(),
  createWorkspace: vi.fn(),
  update: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
  resolveByReference: vi.fn(),
  listWorkspaces: vi.fn(),
  removeWorkspace: vi.fn(),
  updateWorkspace: vi.fn(),
}));

const mockSecretService = vi.hoisted(() => ({
  normalizeEnvBindingsForPersistence: vi.fn(async (_companyId: string, env: unknown) => env),
}));

const mockWorkspaceOperationService = vi.hoisted(() => ({
  createRecorder: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

const mockGithubIssueBridge = vi.hoisted(() => ({
  syncProject: vi.fn(),
}));

const mockDetectGitHubRepo = vi.hoisted(() => vi.fn());

// ---

vi.mock("../services/index.js", () => ({
  projectService: () => mockProjectService,
  secretService: () => mockSecretService,
  workspaceOperationService: () => mockWorkspaceOperationService,
  logActivity: mockLogActivity,
}));

vi.mock("../services/github-issue-bridge.js", () => ({
  githubIssueBridge: () => mockGithubIssueBridge,
  detectGitHubRepo: mockDetectGitHubRepo,
}));

vi.mock("../telemetry.js", () => ({
  getTelemetryClient: () => null,
}));

const companyId = "11111111-1111-4111-8111-111111111111";
const projectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function makeBoardActor() {
  return {
    type: "board",
    userId: "board-user",
    companyIds: [companyId],
    source: "local_implicit",
    isInstanceAdmin: false,
  };
}

function makeCreatedProject(overrides: Record<string, unknown> = {}) {
  return {
    id: projectId,
    companyId,
    name: "Test Project",
    primaryWorkspace: null,
    workspaces: [],
    ...overrides,
  };
}

async function createApp(actor: Record<string, unknown>) {
  const [{ projectRoutes }, { errorHandler }] = await Promise.all([
    vi.importActual<typeof import("../routes/projects.js")>("../routes/projects.js"),
    vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", projectRoutes({} as any));
  app.use(errorHandler);
  return app;
}

describe("project create — GitHub auto-sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: projectService.create returns a project
    mockProjectService.create.mockResolvedValue(makeCreatedProject());
    // Default: no workspace created inline
    mockProjectService.createWorkspace.mockResolvedValue(null);
    mockProjectService.getById.mockResolvedValue(makeCreatedProject());
    // Default: resolveByReference not needed for UUID id
    mockGithubIssueBridge.syncProject.mockResolvedValue({
      imported: 2,
      skippedAlreadyMirrored: 0,
      createdIssueIds: ["i1", "i2"],
      warnings: [],
    });
  });

  it("calls syncProject when the primary workspace has a GitHub remote", async () => {
    const projectWithWorkspace = makeCreatedProject({
      primaryWorkspace: {
        id: "ws-1",
        cwd: "/repos/my-project",
      },
    });
    mockProjectService.create.mockResolvedValue(projectWithWorkspace);
    mockProjectService.getById.mockResolvedValue(projectWithWorkspace);
    mockDetectGitHubRepo.mockResolvedValue("owner/repo");

    const app = await createApp(makeBoardActor());
    const res = await request(app)
      .post(`/api/companies/${companyId}/projects`)
      .send({ name: "My Project" });

    expect(res.status).toBe(201);

    // Give the fire-and-forget microtask a chance to settle
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockDetectGitHubRepo).toHaveBeenCalledWith("/repos/my-project");
    expect(mockGithubIssueBridge.syncProject).toHaveBeenCalledWith(
      projectId,
      expect.objectContaining({ actorId: "board-user" }),
    );
  });

  it("does not call syncProject when there is no GitHub remote", async () => {
    const projectWithWorkspace = makeCreatedProject({
      primaryWorkspace: {
        id: "ws-1",
        cwd: "/repos/local-only",
      },
    });
    mockProjectService.create.mockResolvedValue(projectWithWorkspace);
    mockProjectService.getById.mockResolvedValue(projectWithWorkspace);
    mockDetectGitHubRepo.mockResolvedValue(null);

    const app = await createApp(makeBoardActor());
    await request(app)
      .post(`/api/companies/${companyId}/projects`)
      .send({ name: "Local Only Project" });

    await new Promise((resolve) => setImmediate(resolve));

    expect(mockDetectGitHubRepo).toHaveBeenCalledWith("/repos/local-only");
    expect(mockGithubIssueBridge.syncProject).not.toHaveBeenCalled();
  });

  it("does not call detectGitHubRepo when there is no primary workspace cwd", async () => {
    mockProjectService.create.mockResolvedValue(makeCreatedProject({ primaryWorkspace: null }));
    mockProjectService.getById.mockResolvedValue(makeCreatedProject({ primaryWorkspace: null }));

    const app = await createApp(makeBoardActor());
    await request(app)
      .post(`/api/companies/${companyId}/projects`)
      .send({ name: "No Workspace Project" });

    await new Promise((resolve) => setImmediate(resolve));

    expect(mockDetectGitHubRepo).not.toHaveBeenCalled();
    expect(mockGithubIssueBridge.syncProject).not.toHaveBeenCalled();
  });

  it("logs auto_synced activity after a successful sync", async () => {
    const projectWithWorkspace = makeCreatedProject({
      primaryWorkspace: { id: "ws-1", cwd: "/repos/my-project" },
    });
    mockProjectService.create.mockResolvedValue(projectWithWorkspace);
    mockProjectService.getById.mockResolvedValue(projectWithWorkspace);
    mockDetectGitHubRepo.mockResolvedValue("owner/repo");

    const app = await createApp(makeBoardActor());
    await request(app)
      .post(`/api/companies/${companyId}/projects`)
      .send({ name: "My Project" });

    await new Promise((resolve) => setImmediate(resolve));

    const autoSyncCall = mockLogActivity.mock.calls.find(
      ([, input]: [unknown, { action: string }]) => input.action === "project.github_issue_bridge_auto_synced",
    );
    expect(autoSyncCall).toBeDefined();
    expect(autoSyncCall[1]).toMatchObject({
      action: "project.github_issue_bridge_auto_synced",
      entityType: "project",
      entityId: projectId,
      actorType: "system",
    });
  });

  it("logs auto_sync_failed when syncProject throws", async () => {
    const projectWithWorkspace = makeCreatedProject({
      primaryWorkspace: { id: "ws-1", cwd: "/repos/bad-project" },
    });
    mockProjectService.create.mockResolvedValue(projectWithWorkspace);
    mockProjectService.getById.mockResolvedValue(projectWithWorkspace);
    mockDetectGitHubRepo.mockResolvedValue("owner/bad-repo");
    mockGithubIssueBridge.syncProject.mockRejectedValue(new Error("gh CLI not found"));

    const app = await createApp(makeBoardActor());
    await request(app)
      .post(`/api/companies/${companyId}/projects`)
      .send({ name: "Bad Project" });

    await new Promise((resolve) => setImmediate(resolve));

    const failCall = mockLogActivity.mock.calls.find(
      ([, input]: [unknown, { action: string }]) => input.action === "project.github_issue_bridge_auto_sync_failed",
    );
    expect(failCall).toBeDefined();
    expect(failCall[1]).toMatchObject({
      action: "project.github_issue_bridge_auto_sync_failed",
      entityType: "project",
      entityId: projectId,
      actorType: "system",
    });
  });
});
