import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GithubIssue } from "../services/github-issue-bridge.js";
import { parseGitHubRemoteUrl } from "../services/github-issue-bridge.js";

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

describe("parseGitHubRemoteUrl", () => {
  it("returns owner/repo for a valid https remote", () => {
    expect(parseGitHubRemoteUrl("https://github.com/owner/repo.git")).toBe("owner/repo");
  });

  it("rejects an owner segment starting with --", () => {
    expect(parseGitHubRemoteUrl("https://github.com/--foo/repo")).toBeNull();
  });

  it("rejects a repo segment that is ..", () => {
    expect(parseGitHubRemoteUrl("https://github.com/owner/..")).toBeNull();
  });
});

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

  it("invokes assertCanAssignTo when the resolved assignee is a non-self agent", async () => {
    const project = buildProject();
    const projectService = {
      getById: vi.fn(async () => project),
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
        { id: "ceo-1", role: "ceo", status: "active" },
      ])),
    };
    const ghIssues: GithubIssue[] = [
      {
        number: 30,
        title: "Gate test",
        body: null,
        labels: [],
        url: "https://github.com/NoobyGains/paperclip/issues/30",
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

    const assertCanAssignTo = vi.fn(async (_id: string | null) => {});

    // Caller is "agent-other", assignee resolves to "ceo-1" — non-self
    await bridge.syncProject("project-1", {
      actor: { actorId: "agent-other", agentId: "agent-other" },
      assertCanAssignTo,
    });

    expect(assertCanAssignTo).toHaveBeenCalledOnce();
    expect(assertCanAssignTo).toHaveBeenCalledWith("ceo-1");
  });

  it("does NOT invoke assertCanAssignTo when the resolved assignee equals the calling agent", async () => {
    const project = buildProject({
      primaryWorkspace: {
        ...(buildProject().primaryWorkspace as Record<string, unknown>),
        runtimeConfig: {
          workspaceRuntime: null,
          desiredState: null,
          serviceStates: null,
          githubBridge: { enabled: true, agentIdOverride: "ceo-1" },
        },
      },
    });
    const projectService = {
      getById: vi.fn(async () => project),
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
        { id: "ceo-1", role: "ceo", status: "active" },
      ])),
    };
    const ghIssues: GithubIssue[] = [
      {
        number: 31,
        title: "Self-assign test",
        body: null,
        labels: [],
        url: "https://github.com/NoobyGains/paperclip/issues/31",
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

    const assertCanAssignTo = vi.fn(async (_id: string | null) => {});

    // Caller IS "ceo-1", assignee also resolves to "ceo-1" via override — self
    await bridge.syncProject("project-1", {
      actor: { actorId: "ceo-1", agentId: "ceo-1" },
      assertCanAssignTo,
    });

    expect(assertCanAssignTo).not.toHaveBeenCalled();
  });

  it("propagates an error thrown by assertCanAssignTo and prevents issue creation", async () => {
    const project = buildProject();
    const projectService = {
      getById: vi.fn(async () => project),
    };
    const issueService = {
      create: vi.fn(),
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
        { id: "ceo-1", role: "ceo", status: "active" },
      ])),
    };
    const ghIssues: GithubIssue[] = [
      {
        number: 32,
        title: "Forbidden assign test",
        body: null,
        labels: [],
        url: "https://github.com/NoobyGains/paperclip/issues/32",
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

    const permissionError = new Error("Missing permission: tasks:assign");
    await expect(
      bridge.syncProject("project-1", {
        actor: { actorId: "low-agent", agentId: "low-agent" },
        assertCanAssignTo: async () => { throw permissionError; },
      }),
    ).rejects.toThrow("Missing permission: tasks:assign");

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
  const mockAccessService = vi.hoisted(() => ({
    canUser: vi.fn(async () => true),
    hasPermission: vi.fn(async () => true),
  }));
  const mockAgentService = vi.hoisted(() => ({
    getById: vi.fn(async () => null),
    list: vi.fn(async () => []),
  }));

  function registerModuleMocks() {
    vi.doMock("../services/index.js", () => ({
      logActivity: mockLogActivity,
      projectService: () => mockProjectService,
      accessService: () => mockAccessService,
      agentService: () => mockAgentService,
    }));
    vi.doMock("../services/github-issue-bridge.js", () => ({
      githubIssueBridge: () => mockBridge,
    }));
  }

  async function createApp(
    actorOverride?: Record<string, unknown>,
  ) {
    const [{ githubBridgeRoutes }, { errorHandler }] = await Promise.all([
      vi.importActual<typeof import("../routes/github-bridge.js")>("../routes/github-bridge.js"),
      vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
    ]);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).actor = actorOverride ?? {
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
      expect.objectContaining({
        actor: expect.objectContaining({ actorId: "board-user", agentId: null }),
        assertCanAssignTo: expect.any(Function),
      }),
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

  describe("tasks:assign permission gate", () => {
    it("returns 403 when an agent without tasks:assign would assign to a non-self agent via the bridge", async () => {
      // The bridge calls assertCanAssignTo when it resolves a non-self assignee.
      // We simulate that by having syncProject invoke the callback with a non-self agent id.
      mockBridge.syncProject.mockImplementation(
        async (_projectId: string, opts: { assertCanAssignTo?: (id: string) => Promise<void> }) => {
          // Simulate: bridge resolved assigneeAgentId = "ceo-1", caller is "agent-2"
          if (opts.assertCanAssignTo) await opts.assertCanAssignTo("ceo-1");
          return { imported: 1, skippedAlreadyMirrored: 0, createdIssueIds: ["issue-1"], warnings: [] };
        },
      );
      // Agent actor without tasks:assign grant and not CEO
      mockAccessService.hasPermission.mockResolvedValue(false);
      mockAgentService.getById.mockResolvedValue({
        id: "agent-2",
        companyId: "company-1",
        role: "engineer",
        permissions: {},
      });

      const app = await createApp({
        type: "agent",
        agentId: "agent-2",
        companyId: "company-1",
      });

      const res = await request(app).post("/api/projects/project-1/github-issues/sync");
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ error: expect.stringContaining("tasks:assign") });
    });

    it("succeeds when an agent with tasks:assign calls the sync endpoint", async () => {
      mockBridge.syncProject.mockImplementation(
        async (_projectId: string, opts: { assertCanAssignTo?: (id: string) => Promise<void> }) => {
          if (opts.assertCanAssignTo) await opts.assertCanAssignTo("ceo-1");
          return { imported: 1, skippedAlreadyMirrored: 0, createdIssueIds: ["issue-1"], warnings: [] };
        },
      );
      // Agent has tasks:assign
      mockAccessService.hasPermission.mockResolvedValue(true);

      const app = await createApp({
        type: "agent",
        agentId: "agent-2",
        companyId: "company-1",
      });

      const res = await request(app).post("/api/projects/project-1/github-issues/sync");
      expect(res.status).toBe(200);
    });

    it("succeeds when the bridge assigns to the calling agent itself (self-assign)", async () => {
      // When assigneeAgentId === actor.agentId, assertCanAssignTo is NOT called by the service.
      // We verify the route passes the callback but the bridge (real logic) won't invoke it
      // for self-assignments. Here we simply don't call the callback (as real service does).
      mockBridge.syncProject.mockResolvedValue({
        imported: 1,
        skippedAlreadyMirrored: 0,
        createdIssueIds: ["issue-1"],
        warnings: [],
      });
      mockAccessService.hasPermission.mockResolvedValue(false);

      const app = await createApp({
        type: "agent",
        agentId: "agent-2",
        companyId: "company-1",
      });

      const res = await request(app).post("/api/projects/project-1/github-issues/sync");
      expect(res.status).toBe(200);
    });
  });
});
