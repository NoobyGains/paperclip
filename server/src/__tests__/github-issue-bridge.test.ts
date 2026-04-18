import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GithubIssue } from "../services/github-issue-bridge.js";

function buildProject(overrides: Record<string, unknown> = {}) {
  return {
    id: "project-1",
    companyId: "company-1",
    urlKey: "project-1",
    goalId: null,
    goalIds: [],
    goals: [],
    name: "Project",
    description: null,
    status: "backlog",
    leadAgentId: null,
    targetDate: null,
    color: null,
    env: null,
    pauseReason: null,
    pausedAt: null,
    executionWorkspacePolicy: null,
    codebase: {
      workspaceId: null,
      repoUrl: null,
      repoRef: null,
      defaultRef: null,
      repoName: null,
      localFolder: null,
      managedFolder: "/tmp/project",
      effectiveLocalFolder: "/tmp/project",
      origin: "managed_checkout",
    },
    workspaces: [],
    primaryWorkspace: {
      id: "workspace-1",
      companyId: "company-1",
      projectId: "project-1",
      name: "Primary",
      sourceType: "local_path",
      cwd: "/tmp/project",
      repoUrl: null,
      repoRef: null,
      defaultRef: null,
      visibility: "default",
      setupCommand: null,
      cleanupCommand: null,
      remoteProvider: null,
      remoteWorkspaceRef: null,
      sharedWorkspaceKey: null,
      metadata: null,
      runtimeConfig: {
        workspaceRuntime: null,
        desiredState: null,
        serviceStates: null,
        githubBridge: {
          enabled: true,
        },
      },
      isPrimary: true,
      runtimeServices: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("githubIssueBridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("imports open GitHub issues, stores metadata, and skips already mirrored issues on repeat syncs", async () => {
    const createdIssues: Array<Record<string, unknown>> = [];
    const existingMirrors = createdIssues;
    const project = buildProject({
      primaryWorkspace: {
        ...(buildProject().primaryWorkspace as Record<string, unknown>),
        runtimeConfig: {
          workspaceRuntime: null,
          desiredState: null,
          serviceStates: null,
          githubBridge: {
            enabled: true,
            labelFilter: ["bug"],
            agentIdOverride: "agent-2",
          },
        },
      },
    });

    const projectService = {
      getById: vi.fn(async () => project),
    };
    const issueService = {
      create: vi.fn(async (_companyId: string, input: Record<string, unknown>) => {
        const created = {
          id: `issue-${createdIssues.length + 1}`,
          companyId: "company-1",
          ...input,
        };
        createdIssues.push(created);
        return created;
      }),
    };
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => existingMirrors),
        })),
      })),
    };
    const agentService = {
      list: vi.fn(async () => ([
        { id: "ceo-1", role: "ceo", status: "active" },
        { id: "agent-2", role: "engineer", status: "active" },
      ])),
    };
    const ghIssues: GithubIssue[] = [
      {
        number: 11,
        title: "Bug report",
        body: "Fix me",
        labels: [{ name: "bug" }, { name: "triage" }],
        url: "https://github.com/NoobyGains/paperclip/issues/11",
      },
      {
        number: 12,
        title: "Docs update",
        body: "Ignore me",
        labels: [{ name: "docs" }],
        url: "https://github.com/NoobyGains/paperclip/issues/12",
      },
    ];

    const { githubIssueBridge } = await import("../services/github-issue-bridge.js");
    const bridge = githubIssueBridge(db as never, {
      projectService: projectService as never,
      issueService: issueService as never,
      agentService: agentService as never,
      detectGitHubRepo: vi.fn(async () => "NoobyGains/paperclip"),
      execGh: vi.fn(async () => ghIssues) as never,
    });

    const first = await bridge.syncProject("project-1");
    expect(first).toEqual({
      imported: 1,
      skippedAlreadyMirrored: 0,
      createdIssueIds: ["issue-1"],
      warnings: [],
    });
    expect(issueService.create).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({
        projectId: "project-1",
        title: "[GH#11] Bug report",
        status: "todo",
        priority: "medium",
        assigneeAgentId: "agent-2",
        originKind: "github_issue",
        originId: "NoobyGains/paperclip#11",
        metadata: expect.objectContaining({
          githubIssueNumber: 11,
          githubUrl: "https://github.com/NoobyGains/paperclip/issues/11",
          githubRepo: "NoobyGains/paperclip",
        }),
      }),
    );

    const second = await bridge.syncProject("project-1");
    expect(second).toEqual({
      imported: 0,
      skippedAlreadyMirrored: 1,
      createdIssueIds: [],
      warnings: [],
    });
  });

  it("falls back to a null assignee when there is no CEO or override", async () => {
    const projectService = {
      getById: vi.fn(async () => buildProject()),
    };
    const issueService = {
      create: vi.fn(async (_companyId: string, input: Record<string, unknown>) => ({
        id: "issue-1",
        companyId: "company-1",
        ...input,
      })),
    };
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => []),
        })),
      })),
    };
    const agentService = {
      list: vi.fn(async () => ([
        { id: "agent-1", role: "engineer", status: "active" },
      ])),
    };
    const ghIssues: GithubIssue[] = [
      {
        number: 21,
        title: "Needs triage",
        body: null,
        labels: [],
        url: "https://github.com/NoobyGains/paperclip/issues/21",
      },
    ];

    const { githubIssueBridge } = await import("../services/github-issue-bridge.js");
    const bridge = githubIssueBridge(db as never, {
      projectService: projectService as never,
      issueService: issueService as never,
      agentService: agentService as never,
      detectGitHubRepo: vi.fn(async () => "NoobyGains/paperclip"),
      execGh: vi.fn(async () => ghIssues) as never,
    });

    const result = await bridge.syncProject("project-1");
    expect(result.imported).toBe(1);
    expect(issueService.create).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({ assigneeAgentId: null }),
    );
  });

  it("returns a warning and no imports when the workspace has no GitHub remote", async () => {
    const projectService = {
      getById: vi.fn(async () => buildProject()),
    };
    const issueService = {
      create: vi.fn(),
    };
    const agentService = {
      list: vi.fn(),
    };
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => []),
        })),
      })),
    };

    const { githubIssueBridge } = await import("../services/github-issue-bridge.js");
    const bridge = githubIssueBridge(db as never, {
      projectService: projectService as never,
      issueService: issueService as never,
      agentService: agentService as never,
      detectGitHubRepo: vi.fn(async () => null),
      execGh: vi.fn() as never,
    });

    const result = await bridge.syncProject("project-1");
    expect(result).toEqual({
      imported: 0,
      skippedAlreadyMirrored: 0,
      createdIssueIds: [],
      warnings: ["workspace has no github.com remote"],
    });
    expect(issueService.create).not.toHaveBeenCalled();
  });
});

describe("githubBridgeRoutes", () => {
  const mockProjectService = vi.hoisted(() => ({
    getById: vi.fn(),
  }));
  const mockBridge = vi.hoisted(() => ({
    syncProject: vi.fn(),
  }));
  const mockLogActivity = vi.hoisted(() => vi.fn());

  function registerModuleMocks() {
    vi.doMock("../services/index.js", () => ({
      logActivity: mockLogActivity,
      projectService: () => mockProjectService,
    }));
    vi.doMock("../services/github-issue-bridge.js", () => ({
      githubIssueBridge: () => mockBridge,
    }));
  }

  async function createApp() {
    const [{ githubBridgeRoutes }, { errorHandler }] = await Promise.all([
      vi.importActual<typeof import("../routes/github-bridge.js")>("../routes/github-bridge.js"),
      vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
    ]);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).actor = {
        type: "board",
        userId: "board-user",
        companyIds: ["company-1"],
        source: "local_implicit",
        isInstanceAdmin: false,
      };
      next();
    });
    app.use("/api", githubBridgeRoutes({} as never));
    app.use(errorHandler);
    return app;
  }

  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("../services/index.js");
    vi.doUnmock("../services/github-issue-bridge.js");
    vi.doUnmock("../middleware/index.js");
    registerModuleMocks();
    vi.clearAllMocks();
    mockProjectService.getById.mockResolvedValue({
      id: "project-1",
      companyId: "company-1",
    });
    mockBridge.syncProject.mockResolvedValue({
      imported: 1,
      skippedAlreadyMirrored: 0,
      createdIssueIds: ["issue-1"],
      warnings: [],
    });
  });

  it("syncs a project through the route and logs a summary", async () => {
    const app = await createApp();
    const res = await request(app).post("/api/projects/project-1/github-issues/sync");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      imported: 1,
      skippedAlreadyMirrored: 0,
      createdIssueIds: ["issue-1"],
      warnings: [],
    });
    expect(mockBridge.syncProject).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({ actorId: "board-user", agentId: null }),
    );
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "project.github_issue_bridge_synced",
        entityType: "project",
        entityId: "project-1",
        details: {
          imported: 1,
          skippedAlreadyMirrored: 0,
          createdIssueIds: ["issue-1"],
          warnings: [],
        },
      }),
    );
  });
});
