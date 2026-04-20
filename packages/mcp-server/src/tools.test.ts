import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaperclipApiClient } from "./client.js";
import {
  buildBootstrapAppDescription,
  buildCreateAgentHireDescription,
  buildHireWithProfileDescription,
  createToolDefinitions,
  type OperatorProfile,
} from "./tools.js";

function makeClient() {
  return new PaperclipApiClient({
    apiUrl: "http://localhost:3100/api",
    apiKey: "token-123",
    companyId: "11111111-1111-1111-1111-111111111111",
    agentId: "22222222-2222-2222-2222-222222222222",
    runId: "33333333-3333-3333-3333-333333333333",
  });
}

function getTool(name: string) {
  const tool = createToolDefinitions(makeClient()).find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing tool ${name}`);
  return tool;
}

function mockJsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("paperclip MCP tools", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("adds auth headers and run id to mutating requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ ok: true }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("paperclipUpdateIssue");
    await tool.execute({
      issueId: "PAP-1135",
      status: "done",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe("http://localhost:3100/api/issues/PAP-1135");
    expect(init.method).toBe("PATCH");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer token-123");
    expect((init.headers as Record<string, string>)["X-Paperclip-Run-Id"]).toBe(
      "33333333-3333-3333-3333-333333333333",
    );
  });

  it("uses default company id for company-scoped list tools", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse([{ id: "issue-1" }]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("paperclipListIssues");
    const response = await tool.execute({});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(String(url)).toBe(
      "http://localhost:3100/api/companies/11111111-1111-1111-1111-111111111111/issues",
    );
    expect(response.content[0]?.text).toContain("issue-1");
  });

  it("uses default agent id for checkout requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ id: "PAP-1135", status: "in_progress" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("paperclipCheckoutIssue");
    await tool.execute({
      issueId: "PAP-1135",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      agentId: "22222222-2222-2222-2222-222222222222",
      expectedStatuses: ["todo", "backlog", "blocked"],
    });
  });

  it("defaults issue document format to markdown", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ key: "plan", latestRevisionNumber: 2 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("paperclipUpsertIssueDocument");
    await tool.execute({
      issueId: "PAP-1135",
      key: "plan",
      body: "# Updated",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      format: "markdown",
      body: "# Updated",
    });
  });

  it("creates approvals with the expected company-scoped payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ id: "approval-1" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("paperclipCreateApproval");
    await tool.execute({
      type: "hire_agent",
      payload: { branch: "pap-1167" },
      issueIds: ["44444444-4444-4444-4444-444444444444"],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe(
      "http://localhost:3100/api/companies/11111111-1111-1111-1111-111111111111/approvals",
    );
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      type: "hire_agent",
      payload: { branch: "pap-1167" },
      issueIds: ["44444444-4444-4444-4444-444444444444"],
    });
  });

  it("paperclipMe calls /me and surfaces kind field", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({
        kind: "board",
        userId: "user-1",
        userName: "Alice",
        userEmail: "alice@example.com",
        isInstanceAdmin: false,
        companyIds: ["company-1"],
        source: "board_key",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("paperclipMe");
    const response = await tool.execute({});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(String(url)).toBe("http://localhost:3100/api/me");
    expect(response.content[0]?.text).toContain("\"kind\"");
    expect(response.content[0]?.text).toContain("\"board\"");
  });

  it("rejects invalid generic request paths", async () => {
    vi.stubGlobal("fetch", vi.fn());

    const tool = getTool("paperclipApiRequest");
    const response = await tool.execute({
      method: "GET",
      path: "issues",
    });

    expect(response.content[0]?.text).toContain("path must start with /");
  });

  it("rejects generic request paths that escape /api", async () => {
    vi.stubGlobal("fetch", vi.fn());

    const tool = getTool("paperclipApiRequest");
    const response = await tool.execute({
      method: "GET",
      path: "/../../secret",
    });

    expect(response.content[0]?.text).toContain("must not contain '..'");
  });

  it("release-stale execution lock hits the documented path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ released: true, reason: "run_terminal" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("paperclipReleaseStaleExecutionLock");
    await tool.execute({ issueId: "PAP-77" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe(
      "http://localhost:3100/api/issues/PAP-77/execution-lock/release-stale",
    );
    expect(init.method).toBe("POST");
  });

  it("force-release execution lock forwards the reason", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ released: true, runWasActive: true }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("paperclipForceReleaseExecutionLock");
    await tool.execute({ issueId: "PAP-9", reason: "agent crashed, run stuck" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe(
      "http://localhost:3100/api/issues/PAP-9/execution-lock/force-release",
    );
    expect(JSON.parse(String(init.body))).toEqual({ reason: "agent crashed, run stuck" });
  });

  it("agent-hire tool posts to companies/:id/agent-hires with the hire body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ agent: { id: "agent-9" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("paperclipCreateAgentHire");
    await tool.execute({
      name: "CTO",
      role: "cto",
      adapterType: "codex_local",
      adapterConfig: { cwd: "/repo", model: "o4-mini" },
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe(
      "http://localhost:3100/api/companies/11111111-1111-1111-1111-111111111111/agent-hires",
    );
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body.name).toBe("CTO");
    expect(body.adapterType).toBe("codex_local");
  });

  it("paperclipDiagnoseIssue flags stale lock when run is terminal and suggests recovery", async () => {
    const fetchMock = vi.fn().mockImplementation((url: URL | string) => {
      const path = String(url);
      if (path.endsWith("/api/issues/PAP-42")) {
        return Promise.resolve(
          mockJsonResponse({
            id: "issue-42",
            identifier: "PAP-42",
            status: "in_progress",
            executionRunId: "run-dead",
            executionLockedAt: "2026-04-18T09:00:00Z",
            blockedByIssueIds: [],
          }),
        );
      }
      if (path.includes("/comments")) {
        return Promise.resolve(mockJsonResponse([]));
      }
      if (path.includes("/heartbeat-runs/run-dead")) {
        return Promise.resolve(
          mockJsonResponse({
            id: "run-dead",
            status: "failed",
            error: "process crashed",
          }),
        );
      }
      return Promise.resolve(mockJsonResponse({}));
    });
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("paperclipDiagnoseIssue");
    const response = await tool.execute({ issueId: "PAP-42" });

    const payload = JSON.parse(response.content[0]!.text);
    expect(payload.staleLock).toBe(true);
    expect(payload.currentRun.status).toBe("failed");
    expect(payload.suggestedAction).toContain("paperclipReleaseStaleExecutionLock");
  });

  it("sets isError:true when a tool call fails so the operator-LLM can detect it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "permission denied" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("paperclipGetIssue");
    const response = await tool.execute({ issueId: "PAP-99" });

    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toContain("permission denied");
  });

  it("paperclipDiagnoseBottlenecks hits the correct bottlenecks path with default companyId", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({
        reviewQueue: [],
        overloadedAgents: [],
        stuckInReview: [],
        summary: { criticalCount: 0, warnCount: 0 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("paperclipDiagnoseBottlenecks");
    const response = await tool.execute({});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(String(url)).toBe(
      "http://localhost:3100/api/companies/11111111-1111-1111-1111-111111111111/bottlenecks",
    );
    const payload = JSON.parse(response.content[0]!.text);
    expect(payload.summary.criticalCount).toBe(0);
  });

  it("attaches readOnly/destructive/idempotent annotations per tool category", () => {
    // Spot-check that the central annotation map reaches each category.
    const read = getTool("paperclipDiagnoseIssue").annotations;
    const update = getTool("paperclipReleaseStaleExecutionLock").annotations;
    const destructive = getTool("paperclipForceReleaseExecutionLock").annotations;

    expect(read?.readOnlyHint).toBe(true);
    expect(read?.destructiveHint).toBe(false);

    expect(update?.readOnlyHint).toBe(false);
    expect(update?.idempotentHint).toBe(true);
    expect(update?.destructiveHint).toBe(false);

    expect(destructive?.destructiveHint).toBe(true);
    expect(destructive?.readOnlyHint).toBe(false);
  });

  it("annotates the raw api escape hatch with openWorldHint so clients prompt before use", () => {
    const tool = getTool("paperclipApiRequest");
    expect(tool.annotations?.openWorldHint).toBe(true);
  });

  // #58 — first-class MCP tool for triggering the github-issue-bridge
  // sync (in addition to the fire-and-forget auto-sync on project create).
  it("paperclipSyncProjectGithub POSTs to /projects/:id/github-issues/sync", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ imported: 4, skippedAlreadyMirrored: 0, createdIssueIds: [], warnings: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("paperclipSyncProjectGithub");
    const response = await tool.execute({
      projectId: "55555555-5555-5555-5555-555555555555",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe(
      "http://localhost:3100/api/projects/55555555-5555-5555-5555-555555555555/github-issues/sync",
    );
    expect(init.method).toBe("POST");
    const payload = JSON.parse(response.content[0]!.text);
    expect(payload.imported).toBe(4);
  });

  it("paperclipListHiringProfiles returns all seven profiles with expanded adapterConfig", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const tool = getTool("paperclipListHiringProfiles");
    const response = await tool.execute({});
    const payload = JSON.parse(response.content[0]!.text);
    expect(Array.isArray(payload)).toBe(true);
    expect(payload).toHaveLength(7);
    const ids = payload.map((p: { id: string }) => p.id).sort();
    expect(ids).toEqual([
      "coding-heavy",
      "coding-light",
      "coding-standard",
      "reasoning-heavy",
      "reasoning-standard",
      "research",
      "reviewer",
    ]);
    const codingHeavy = payload.find((p: { id: string }) => p.id === "coding-heavy");
    expect(codingHeavy.adapterType).toBe("codex_local");
    expect(codingHeavy.adapterConfig.model).toBe("gpt-5.4");
    expect(codingHeavy.capabilities.webSearch).toBe(true);
  });

  it("paperclipHireWithProfile expands coding-heavy into codex_local + gpt-5.4 + search=true", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ id: "agent-new", name: "Backend Eng" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("paperclipHireWithProfile");
    await tool.execute({
      name: "Backend Eng",
      role: "engineer",
      profile: "coding-heavy",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe(
      "http://localhost:3100/api/companies/11111111-1111-1111-1111-111111111111/agent-hires",
    );
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body.adapterType).toBe("codex_local");
    expect(body.adapterConfig.model).toBe("gpt-5.4");
    expect(body.adapterConfig.search).toBe(true);
    expect(body.adapterConfig.fastMode).toBe(true);
    expect(body.adapterConfig.modelReasoningEffort).toBe("high");
  });

  it("paperclipHireWithProfile reviewer profile maps to claude_local + Opus 4.7", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ id: "reviewer-1" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("paperclipHireWithProfile");
    await tool.execute({
      name: "Reviewer",
      role: "researcher",
      profile: "reviewer",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.adapterType).toBe("claude_local");
    expect(body.adapterConfig.model).toBe("claude-opus-4-7");
    expect(body.adapterConfig.effort).toBe("high");
    // claude_local doesn't take adapterConfig.search — the webSearch capability
    // falls through to L3's skill-injection path once that ships.
    expect(body.adapterConfig.search).toBeUndefined();
  });

  it("paperclipHireWithProfile applies adapterConfigOverride after the profile", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse({ id: "a" }));
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("paperclipHireWithProfile");
    await tool.execute({
      name: "Dev",
      role: "engineer",
      profile: "coding-standard",
      adapterConfigOverride: { model: "gpt-5.4" },
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.adapterConfig.model).toBe("gpt-5.4"); // override wins
    expect(body.adapterConfig.modelReasoningEffort).toBe("medium"); // profile preserved
  });

  it("paperclipBootstrapApp chains create-company → patch defaults → CEO → reviewer → patch reviewer → project", async () => {
    const calls: Array<{ method: string; url: string; body: unknown }> = [];
    const fetchMock = vi.fn().mockImplementation(async (url: URL | string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ method, url: u, body });

      if (method === "POST" && u.endsWith("/api/companies")) {
        return mockJsonResponse({ id: "c-1", name: "My App workspace" });
      }
      if (method === "PATCH" && u.includes("/api/companies/c-1")) {
        return mockJsonResponse({
          id: "c-1",
          name: "My App workspace",
          autoHireEnabled: true,
          requireBoardApprovalForNewAgents: false,
          defaultHireAdapter: "codex_local",
          autoReviewEnabled: true,
        });
      }
      if (method === "POST" && u.includes("/api/companies/c-1/agents")) {
        return mockJsonResponse({ id: "ceo-1", name: "CEO", adapterType: "claude_local" });
      }
      if (method === "POST" && u.includes("/api/project-archetype/detect")) {
        return mockJsonResponse({ stack: "unknown" });
      }
      if (method === "POST" && u.includes("/api/companies/c-1/agent-hires")) {
        return mockJsonResponse({ id: "reviewer-1", agentId: "reviewer-1" });
      }
      if (method === "POST" && u.includes("/api/companies/c-1/projects")) {
        return mockJsonResponse({ id: "proj-1", name: "My App", workspace: {} });
      }
      if (method === "POST" && u.includes("/api/companies/c-1/goals")) {
        return mockJsonResponse({ id: "goal-1", title: "Ship My App", level: "company", status: "active" });
      }
      if (method === "PATCH" && u.includes("/api/projects/proj-1")) {
        return mockJsonResponse({ id: "proj-1", goalId: "goal-1" });
      }
      throw new Error(`Unmocked ${method} ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("paperclipBootstrapApp");
    const response = await tool.execute({
      name: "My App",
      repoPath: "/tmp/nonexistent-for-test",
      writeProjectConfig: false,
    });

    const payload = JSON.parse(response.content[0]!.text);
    expect(payload.status).toBe("created");
    expect(payload.company.autoHireEnabled).toBe(true);
    expect(payload.company.requireBoardApprovalForNewAgents).toBe(false);
    expect(payload.company.defaultHireAdapter).toBe("codex_local");
    expect(payload.company.autoReviewEnabled).toBe(true);
    expect(payload.company.defaultReviewerAgentId).toBe("reviewer-1");
    expect(payload.ceo.id).toBe("ceo-1");
    expect(payload.ceo.defaultHiringProfile).toBe("coding-heavy");
    expect(payload.reviewer).toMatchObject({ hired: true, agentId: "reviewer-1", error: null });
    expect(payload.project.id).toBe("proj-1");

    // Spot-check the key calls by URL rather than strict index order
    // (shaped-team detection + goal creation add intermediate calls).
    const createCompanyCall = calls.find((c) => c.method === "POST" && c.url.endsWith("/api/companies"));
    expect(createCompanyCall).toBeDefined();

    const patchDefaultsCall = calls.find((c) => c.method === "PATCH" && c.url.includes("/api/companies/c-1") && !c.url.includes("/agents"));
    expect(patchDefaultsCall?.body).toMatchObject({
      autoHireEnabled: true,
      requireBoardApprovalForNewAgents: false,
      defaultHireAdapter: "codex_local",
      autoReviewEnabled: true,
    });

    const createCeoCall = calls.find((c) => c.url.includes("/api/companies/c-1/agents"));
    expect(createCeoCall).toBeDefined();
    expect((createCeoCall?.body as { capabilities?: string })?.capabilities).toContain("coding-heavy");

    const reviewerHireCall = calls.find((c) => c.url.includes("/api/companies/c-1/agent-hires") && (c.body as Record<string, unknown>)?.role === "reviewer");
    expect(reviewerHireCall).toBeDefined();
    expect((reviewerHireCall?.body as Record<string, unknown>)?.adapterType).toBe("claude_local");

    const createProjectCall = calls.find((c) => c.url.includes("/api/companies/c-1/projects"));
    expect(createProjectCall).toBeDefined();
  });

  it("paperclipBootstrapApp skips reviewer hire when hireReviewer=false", async () => {
    const calls: Array<{ method: string; url: string; body: unknown }> = [];
    const fetchMock = vi.fn().mockImplementation(async (url: URL | string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ method, url: u, body });

      if (method === "POST" && u.endsWith("/api/companies")) {
        return mockJsonResponse({ id: "c-2", name: "No-Review App workspace" });
      }
      if (method === "PATCH" && u.includes("/api/companies/c-2")) {
        return mockJsonResponse({
          id: "c-2",
          name: "No-Review App workspace",
          autoHireEnabled: true,
          requireBoardApprovalForNewAgents: false,
        });
      }
      if (method === "POST" && u.includes("/api/companies/c-2/agents")) {
        return mockJsonResponse({ id: "ceo-2", name: "CEO", adapterType: "claude_local" });
      }
      if (method === "POST" && u.includes("/api/project-archetype/detect")) {
        return mockJsonResponse({ stack: "unknown" });
      }
      if (method === "POST" && u.includes("/api/companies/c-2/agent-hires")) {
        return mockJsonResponse({ id: "eng-2", agentId: "eng-2" });
      }
      if (method === "POST" && u.includes("/api/companies/c-2/projects")) {
        return mockJsonResponse({ id: "proj-2", name: "No-Review App", workspace: {} });
      }
      if (method === "POST" && u.includes("/api/companies/c-2/goals")) {
        return mockJsonResponse({ id: "goal-2", title: "Ship No-Review App" });
      }
      if (method === "PATCH" && u.includes("/api/projects/proj-2")) {
        return mockJsonResponse({ id: "proj-2", goalId: "goal-2" });
      }
      throw new Error(`Unmocked ${method} ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("paperclipBootstrapApp");
    const response = await tool.execute({
      name: "No-Review App",
      repoPath: "/tmp/nonexistent-for-test-2",
      writeProjectConfig: false,
      hireReviewer: false,
    });

    const payload = JSON.parse(response.content[0]!.text);
    expect(payload.status).toBe("created");
    expect(payload.reviewer).toBeNull();
    expect(payload.company.defaultReviewerAgentId).toBeNull();
    // Reviewer-specific hire (role="reviewer") must not have been called.
    // Shaped-team hires may still post to /agent-hires for non-reviewer slots.
    const reviewerHire = calls.find(
      (c) => c.url.includes("/agent-hires") && (c.body as Record<string, unknown>)?.role === "reviewer",
    );
    expect(reviewerHire).toBeUndefined();
  });

  it("paperclipBootstrapApp reports reviewer-hire failure as a warning without aborting", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: URL | string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";

      if (method === "POST" && u.endsWith("/api/companies")) {
        return mockJsonResponse({ id: "c-3", name: "Flaky-Reviewer App workspace" });
      }
      if (method === "PATCH" && u.includes("/api/companies/c-3")) {
        return mockJsonResponse({
          id: "c-3",
          name: "Flaky-Reviewer App workspace",
          autoHireEnabled: true,
          requireBoardApprovalForNewAgents: false,
        });
      }
      if (method === "POST" && u.includes("/api/companies/c-3/agents")) {
        return mockJsonResponse({ id: "ceo-3", name: "CEO", adapterType: "claude_local" });
      }
      if (method === "POST" && u.includes("/api/project-archetype/detect")) {
        return mockJsonResponse({ stack: "unknown" });
      }
      if (method === "POST" && u.includes("/api/companies/c-3/agent-hires")) {
        return mockJsonResponse({ error: "subscription gate rejected" }, 403);
      }
      if (method === "POST" && u.includes("/api/companies/c-3/projects")) {
        return mockJsonResponse({ id: "proj-3", name: "Flaky-Reviewer App", workspace: {} });
      }
      if (method === "POST" && u.includes("/api/companies/c-3/goals")) {
        return mockJsonResponse({ id: "goal-3", title: "Ship Flaky-Reviewer App" });
      }
      if (method === "PATCH" && u.includes("/api/projects/proj-3")) {
        return mockJsonResponse({ id: "proj-3", goalId: "goal-3" });
      }
      throw new Error(`Unmocked ${method} ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("paperclipBootstrapApp");
    const response = await tool.execute({
      name: "Flaky-Reviewer App",
      repoPath: "/tmp/nonexistent-for-test-3",
      writeProjectConfig: false,
    });

    const payload = JSON.parse(response.content[0]!.text);
    expect(payload.status).toBe("created_with_warnings");
    expect(payload.reviewer.hired).toBe(false);
    expect(payload.reviewer.error).toBeTruthy();
    expect(payload.project.id).toBe("proj-3");
    const warningStep = payload.nextSteps.find((s: string) => s.includes("Reviewer bootstrap failed"));
    expect(warningStep).toBeTruthy();
  });

  describe("paperclipBootstrapApp — Goal creation (issue #57)", () => {
    function makeBootstrapFetchMock(companyId: string, opts: { failGoal?: boolean } = {}) {
      const calls: Array<{ method: string; url: string; body: unknown }> = [];
      const mock = vi.fn().mockImplementation(async (url: URL | string, init?: RequestInit) => {
        const u = String(url);
        const method = init?.method ?? "GET";
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        calls.push({ method, url: u, body });

        if (method === "POST" && u.endsWith("/api/companies")) {
          return mockJsonResponse({ id: companyId, name: "Test App workspace" });
        }
        if (method === "PATCH" && u.includes(`/api/companies/${companyId}`)) {
          return mockJsonResponse({ id: companyId, name: "Test App workspace", autoHireEnabled: true, requireBoardApprovalForNewAgents: false, defaultHireAdapter: "codex_local", autoReviewEnabled: true });
        }
        if (method === "POST" && u.includes(`/api/companies/${companyId}/agents`)) {
          return mockJsonResponse({ id: "ceo-x", name: "CEO", adapterType: "claude_local" });
        }
        if (method === "POST" && u.includes(`/api/companies/${companyId}/agent-hires`)) {
          return mockJsonResponse({ id: "rev-x", agentId: "rev-x" });
        }
        // Archetype detection
        if (method === "POST" && u.includes("/api/project-archetype/detect")) {
          return mockJsonResponse({ stack: "unknown" });
        }
        if (method === "POST" && u.includes(`/api/companies/${companyId}/projects`)) {
          return mockJsonResponse({ id: "proj-x", name: "Test App", workspace: {} });
        }
        if (method === "POST" && u.includes(`/api/companies/${companyId}/goals`)) {
          if (opts.failGoal) {
            return mockJsonResponse({ error: "validation failed" }, 422);
          }
          return mockJsonResponse({ id: "goal-x", title: "Ship Test App", level: "company", status: "active" });
        }
        if (method === "PATCH" && u.includes("/api/projects/proj-x")) {
          return mockJsonResponse({ id: "proj-x", goalId: "goal-x" });
        }
        throw new Error(`Unmocked ${method} ${u}`);
      });
      return { mock, calls };
    }

    it("default flow creates a goal with title 'Ship <name>' and links it to the project", async () => {
      const { mock, calls } = makeBootstrapFetchMock("c-goal-1");
      vi.stubGlobal("fetch", mock);

      const tool = getTool("paperclipBootstrapApp");
      const response = await tool.execute({
        name: "Test App",
        repoPath: "/tmp/test-app",
        writeProjectConfig: false,
        hireShapedTeam: false,
      });

      const payload = JSON.parse(response.content[0]!.text);
      expect(payload.status).toBe("created");
      expect(payload.goal).toMatchObject({ created: true, id: "goal-x" });

      // Verify POST /companies/:id/goals was called with correct body
      const goalCall = calls.find((c) => c.url.includes("/goals") && c.method === "POST");
      expect(goalCall).toBeDefined();
      expect((goalCall!.body as Record<string, unknown>).title).toBe("Ship Test App");
      expect((goalCall!.body as Record<string, unknown>).level).toBe("company");
      expect((goalCall!.body as Record<string, unknown>).status).toBe("active");
      expect((goalCall!.body as Record<string, unknown>).ownerAgentId).toBe("ceo-x");

      // Verify PATCH /projects/:id was called with goalId
      const patchProjectCall = calls.find((c) => c.url.includes("/api/projects/proj-x") && c.method === "PATCH");
      expect(patchProjectCall).toBeDefined();
      expect((patchProjectCall!.body as Record<string, unknown>).goalId).toBe("goal-x");
    });

    it("uses custom goalTitle when provided", async () => {
      const { mock, calls } = makeBootstrapFetchMock("c-goal-2");
      vi.stubGlobal("fetch", mock);

      const tool = getTool("paperclipBootstrapApp");
      await tool.execute({
        name: "Test App",
        repoPath: "/tmp/test-app",
        writeProjectConfig: false,
        hireShapedTeam: false,
        goalTitle: "Launch v2.0 by Q3",
      });

      const goalCall = calls.find((c) => c.url.includes("/goals") && c.method === "POST");
      expect(goalCall).toBeDefined();
      expect((goalCall!.body as Record<string, unknown>).title).toBe("Launch v2.0 by Q3");
    });

    it("createGoal=false skips goal creation entirely", async () => {
      const { mock, calls } = makeBootstrapFetchMock("c-goal-3");
      vi.stubGlobal("fetch", mock);

      const tool = getTool("paperclipBootstrapApp");
      const response = await tool.execute({
        name: "Test App",
        repoPath: "/tmp/test-app",
        writeProjectConfig: false,
        hireShapedTeam: false,
        createGoal: false,
      });

      const payload = JSON.parse(response.content[0]!.text);
      expect(payload.goal).toBeNull();
      const goalCall = calls.find((c) => c.url.includes("/goals") && c.method === "POST");
      expect(goalCall).toBeUndefined();
    });

    it("goal creation failure is a warning — project still created", async () => {
      const { mock } = makeBootstrapFetchMock("c-goal-4", { failGoal: true });
      vi.stubGlobal("fetch", mock);

      const tool = getTool("paperclipBootstrapApp");
      const response = await tool.execute({
        name: "Test App",
        repoPath: "/tmp/test-app",
        writeProjectConfig: false,
        hireShapedTeam: false,
      });

      const payload = JSON.parse(response.content[0]!.text);
      expect(payload.status).toBe("created_with_warnings");
      expect(payload.goal.created).toBe(false);
      expect(payload.goal.error).toBeTruthy();
      expect(payload.project.id).toBe("proj-x");
    });
  });

  describe("paperclipBootstrapApp — shaped team hire (issue #57)", () => {
    function makeBootstrapWithShapedTeamMock(companyId: string, opts: { archetypeStack?: string; failSlot?: boolean } = {}) {
      const calls: Array<{ method: string; url: string; body: unknown }> = [];
      const mock = vi.fn().mockImplementation(async (url: URL | string, init?: RequestInit) => {
        const u = String(url);
        const method = init?.method ?? "GET";
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        calls.push({ method, url: u, body });

        if (method === "POST" && u.endsWith("/api/companies")) {
          return mockJsonResponse({ id: companyId, name: "Shaped App workspace" });
        }
        if (method === "PATCH" && u.includes(`/api/companies/${companyId}`)) {
          return mockJsonResponse({ id: companyId, name: "Shaped App workspace", autoHireEnabled: true, requireBoardApprovalForNewAgents: false });
        }
        if (method === "POST" && u.includes(`/api/companies/${companyId}/agents`)) {
          return mockJsonResponse({ id: "ceo-s", name: "CEO", adapterType: "claude_local" });
        }
        if (method === "POST" && u.includes("/api/project-archetype/detect")) {
          return mockJsonResponse({ stack: opts.archetypeStack ?? "unknown" });
        }
        if (method === "POST" && u.includes(`/api/companies/${companyId}/agent-hires`)) {
          const b = body as Record<string, unknown>;
          if (opts.failSlot && b.role !== "reviewer") {
            return mockJsonResponse({ error: "hire rejected" }, 422);
          }
          return mockJsonResponse({ id: `hire-${b.role as string}`, agentId: `hire-${b.role as string}` });
        }
        if (method === "POST" && u.includes(`/api/companies/${companyId}/projects`)) {
          return mockJsonResponse({ id: "proj-s", name: "Shaped App", workspace: {} });
        }
        if (method === "POST" && u.includes(`/api/companies/${companyId}/goals`)) {
          return mockJsonResponse({ id: "goal-s", title: "Ship Shaped App" });
        }
        if (method === "PATCH" && u.includes("/api/projects/proj-s")) {
          return mockJsonResponse({ id: "proj-s" });
        }
        throw new Error(`Unmocked ${method} ${u}`);
      });
      return { mock, calls };
    }

    it("default flow detects archetype and hires shaped team slots (skips reviewer)", async () => {
      const { mock, calls } = makeBootstrapWithShapedTeamMock("c-shape-1", { archetypeStack: "unknown" });
      vi.stubGlobal("fetch", mock);

      const tool = getTool("paperclipBootstrapApp");
      const response = await tool.execute({
        name: "Shaped App",
        repoPath: "/tmp/shaped-app",
        writeProjectConfig: false,
        hireReviewer: true,
      });

      const payload = JSON.parse(response.content[0]!.text);
      expect(payload.shapedTeam).toBeDefined();
      expect(payload.shapedTeam.archetype).toBe("unknown");
      // unknown archetype has 2 roles (engineer + reviewer); reviewer is skipped, so 1 hire
      const hires = payload.shapedTeam.hires as Array<{ role: string; status: string }>;
      const reviewerInShapedHires = hires.find((h) => h.role === "reviewer");
      expect(reviewerInShapedHires).toBeUndefined(); // reviewer slot is skipped

      // Archetype detection call should be present
      const detectCall = calls.find((c) => c.url.includes("/project-archetype/detect") && c.method === "POST");
      expect(detectCall).toBeDefined();
      expect((detectCall!.body as Record<string, unknown>).repoPath).toBeTruthy();
    });

    it("hireShapedTeam=false skips archetype detection and team hiring", async () => {
      const { mock, calls } = makeBootstrapWithShapedTeamMock("c-shape-2");
      vi.stubGlobal("fetch", mock);

      const tool = getTool("paperclipBootstrapApp");
      const response = await tool.execute({
        name: "Shaped App",
        repoPath: "/tmp/shaped-app",
        writeProjectConfig: false,
        hireShapedTeam: false,
        hireReviewer: false,
      });

      const payload = JSON.parse(response.content[0]!.text);
      expect(payload.shapedTeam).toBeNull();
      const detectCall = calls.find((c) => c.url.includes("/project-archetype/detect"));
      expect(detectCall).toBeUndefined();
    });

    it("partial shaped-team hire failure is non-fatal and reported per slot", async () => {
      const { mock } = makeBootstrapWithShapedTeamMock("c-shape-3", { archetypeStack: "unknown", failSlot: true });
      vi.stubGlobal("fetch", mock);

      const tool = getTool("paperclipBootstrapApp");
      const response = await tool.execute({
        name: "Shaped App",
        repoPath: "/tmp/shaped-app",
        writeProjectConfig: false,
        hireReviewer: false,
      });

      const payload = JSON.parse(response.content[0]!.text);
      // Project should still be created despite slot failure
      expect(payload.project.id).toBe("proj-s");
      // shapedTeam should report the failure
      const hires = payload.shapedTeam.hires as Array<{ status: string }>;
      const failed = hires.filter((h) => h.status === "failed");
      expect(failed.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("operator profile tools (F1)", () => {
    it("paperclipGetMyProfile round-trips default profile", async () => {
      const defaultProfile = {
        subscriptionOnly: true,
        claudeSubscription: null,
        codexSubscription: null,
        preferences: {},
      };
      const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse(defaultProfile));
      vi.stubGlobal("fetch", fetchMock);

      const tool = getTool("paperclipGetMyProfile");
      const response = await tool.execute({});

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url] = fetchMock.mock.calls[0] as [string];
      expect(String(url)).toBe("http://localhost:3100/api/me/profile");
      const payload = JSON.parse(response.content[0]!.text);
      expect(payload.subscriptionOnly).toBe(true);
      expect(payload.claudeSubscription).toBeNull();
      expect(payload.codexSubscription).toBeNull();
    });

    it("paperclipUpdateMyProfile forwards the patch body", async () => {
      const updated = {
        subscriptionOnly: false,
        claudeSubscription: "pro",
        codexSubscription: null,
        preferences: {},
      };
      const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse(updated));
      vi.stubGlobal("fetch", fetchMock);

      const tool = getTool("paperclipUpdateMyProfile");
      await tool.execute({ subscriptionOnly: false, claudeSubscription: "pro" });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(String(url)).toBe("http://localhost:3100/api/me/profile");
      expect(init.method).toBe("PATCH");
      const body = JSON.parse(String(init.body));
      expect(body.subscriptionOnly).toBe(false);
      expect(body.claudeSubscription).toBe("pro");
    });
  });

  it("paperclipDiagnoseIssue does not flag stale lock when run is active", async () => {
    const fetchMock = vi.fn().mockImplementation((url: URL | string) => {
      const path = String(url);
      if (path.endsWith("/api/issues/PAP-43")) {
        return Promise.resolve(
          mockJsonResponse({
            id: "issue-43",
            identifier: "PAP-43",
            status: "in_progress",
            executionRunId: "run-alive",
            executionLockedAt: "2026-04-18T09:20:00Z",
            blockedByIssueIds: [],
          }),
        );
      }
      if (path.includes("/comments")) {
        return Promise.resolve(mockJsonResponse([]));
      }
      if (path.includes("/heartbeat-runs/run-alive")) {
        return Promise.resolve(
          mockJsonResponse({ id: "run-alive", status: "running" }),
        );
      }
      return Promise.resolve(mockJsonResponse({}));
    });
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("paperclipDiagnoseIssue");
    const response = await tool.execute({ issueId: "PAP-43" });

    const payload = JSON.parse(response.content[0]!.text);
    expect(payload.staleLock).toBe(false);
    expect(payload.suggestedAction).toBeNull();
  });

  describe("dynamic (profile-derived) tool descriptions (P4)", () => {
    const subscriptionOnlyProfile: OperatorProfile = {
      subscriptionOnly: true,
      claudeSubscription: null,
      codexSubscription: null,
    };

    const apiProfile: OperatorProfile = {
      subscriptionOnly: false,
      claudeSubscription: "pro",
      codexSubscription: "max",
    };

    // -----------------------------------------------------------------------
    // buildHireWithProfileDescription
    // -----------------------------------------------------------------------
    it("paperclipHireWithProfile description contains 'subscription-only mode' when profile.subscriptionOnly=true", () => {
      const desc = buildHireWithProfileDescription(subscriptionOnlyProfile);
      expect(desc).toContain("subscription-only mode");
    });

    it("paperclipHireWithProfile description lists profile names when subscriptionOnly=true", () => {
      const desc = buildHireWithProfileDescription(subscriptionOnlyProfile);
      expect(desc).toContain("coding-heavy");
      expect(desc).toContain("reviewer");
      expect(desc).toContain("research");
    });

    it("paperclipHireWithProfile description includes subscription tiers when subscriptionOnly=false", () => {
      const desc = buildHireWithProfileDescription(apiProfile);
      expect(desc).toContain("Codex subscription: max");
      expect(desc).toContain("Claude subscription: pro");
      expect(desc).not.toContain("subscription-only mode");
    });

    it("paperclipHireWithProfile description falls back to static when profile is null", () => {
      const desc = buildHireWithProfileDescription(null);
      expect(desc).toContain("Hire a new agent using one of the CEO hiring profiles");
      expect(desc).not.toContain("subscription-only mode");
    });

    // -----------------------------------------------------------------------
    // buildBootstrapAppDescription
    // -----------------------------------------------------------------------
    it("paperclipBootstrapApp description contains 'subscription-only mode' when profile.subscriptionOnly=true", () => {
      const desc = buildBootstrapAppDescription(subscriptionOnlyProfile);
      expect(desc).toContain("subscription-only mode");
    });

    it("paperclipBootstrapApp description lists active subscriptions when subscriptionOnly=false", () => {
      const desc = buildBootstrapAppDescription(apiProfile);
      expect(desc).toContain("Codex (max)");
      expect(desc).toContain("Claude (pro)");
      expect(desc).not.toContain("subscription-only mode");
    });

    it("paperclipBootstrapApp description falls back to static when profile is null", () => {
      const desc = buildBootstrapAppDescription(null);
      expect(desc).toContain("One-call app onboarding");
      expect(desc).not.toContain("subscription-only mode");
    });

    // -----------------------------------------------------------------------
    // buildCreateAgentHireDescription
    // -----------------------------------------------------------------------
    it("paperclipCreateAgentHire description contains 'subscription-only mode' when profile.subscriptionOnly=true", () => {
      const desc = buildCreateAgentHireDescription(subscriptionOnlyProfile);
      expect(desc).toContain("subscription-only mode");
    });

    it("paperclipCreateAgentHire description lists active subscriptions when subscriptionOnly=false", () => {
      const desc = buildCreateAgentHireDescription(apiProfile);
      expect(desc).toContain("Codex (max)");
      expect(desc).toContain("Claude (pro)");
      expect(desc).not.toContain("subscription-only mode");
    });

    it("paperclipCreateAgentHire description falls back to static when profile is null", () => {
      const desc = buildCreateAgentHireDescription(null);
      expect(desc).toContain("Submit an agent-hire request");
      expect(desc).not.toContain("subscription-only mode");
    });

    // -----------------------------------------------------------------------
    // Integration: createToolDefinitions wires profile into tool descriptions
    // -----------------------------------------------------------------------
    it("createToolDefinitions wires subscription-only profile into paperclipHireWithProfile description", () => {
      const client = makeClient();
      const tools = createToolDefinitions(client, subscriptionOnlyProfile);
      const tool = tools.find((t) => t.name === "paperclipHireWithProfile");
      expect(tool).toBeDefined();
      expect(tool!.description).toContain("subscription-only mode");
    });

    it("createToolDefinitions uses static description for paperclipHireWithProfile when no profile", () => {
      const client = makeClient();
      const tools = createToolDefinitions(client, null);
      const tool = tools.find((t) => t.name === "paperclipHireWithProfile");
      expect(tool).toBeDefined();
      expect(tool!.description).not.toContain("subscription-only mode");
    });

    // -----------------------------------------------------------------------
    // getCachedProfile session caching
    // -----------------------------------------------------------------------
    it("getCachedProfile returns null on fetch failure and does not throw", async () => {
      const client = makeClient();
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new Error("network down")),
      );
      const result = await client.getCachedProfile();
      expect(result).toBeNull();
    });

    it("getCachedProfile only fetches once even if called multiple times", async () => {
      const client = makeClient();
      const profile = { subscriptionOnly: true };
      const fetchMock = vi
        .fn()
        .mockResolvedValue(mockJsonResponse(profile));
      vi.stubGlobal("fetch", fetchMock);

      const [r1, r2, r3] = await Promise.all([
        client.getCachedProfile(),
        client.getCachedProfile(),
        client.getCachedProfile(),
      ]);

      expect(r1).toEqual(profile);
      expect(r2).toEqual(profile);
      expect(r3).toEqual(profile);
      // Profile endpoint called exactly once despite three concurrent calls.
      const profileCalls = fetchMock.mock.calls.filter((args) =>
        String(args[0]).includes("/me/profile"),
      );
      expect(profileCalls.length).toBe(1);
    });
  });

  it("paperclipDetectProjectArchetype forwards repoPath and returns descriptor", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ stack: "pnpm-monorepo", packageManager: "pnpm" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("paperclipDetectProjectArchetype");
    const response = await tool.execute({ repoPath: "/path/to/repo" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe("http://localhost:3100/api/project-archetype/detect");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ repoPath: "/path/to/repo" });

    const payload = JSON.parse(response.content[0]!.text);
    expect(payload.stack).toBe("pnpm-monorepo");
    expect(payload.packageManager).toBe("pnpm");
  });

  it("paperclipWriteCeoOverlay forwards projectId and files", async () => {
    const projId = "00000000-0000-0000-0000-000000000001";
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ written: ["AGENTS.md"], repoPath: "/path/to/repo" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("paperclipWriteCeoOverlay");
    const response = await tool.execute({ projectId: projId, files: { "AGENTS.md": "# test" } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain(projId);
    expect(String(url)).toContain("ceo-overlay");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body.files["AGENTS.md"]).toBe("# test");

    const payload = JSON.parse(response.content[0]!.text);
    expect(payload.written).toEqual(["AGENTS.md"]);
  });

  describe("R1 — paperclipGetTeamShape tool", () => {
    it("returns the pnpm-monorepo shape with cto + two engineers + qa + reviewer", async () => {
      vi.stubGlobal("fetch", vi.fn());

      const tool = getTool("paperclipGetTeamShape");
      const response = await tool.execute({ archetype: "pnpm-monorepo" });

      expect(response.isError).toBeFalsy();
      const payload = JSON.parse(response.content[0]!.text);
      expect(payload.archetype).toBe("pnpm-monorepo");
      const roles = payload.shape.roles.map((r: { role: string }) => r.role);
      expect(roles).toContain("cto");
      expect(roles).toContain("qa");
      expect(roles).toContain("reviewer");
      expect(roles.filter((r: string) => r === "engineer")).toHaveLength(2);
    });

    it("returns the rust-cargo shape with Senior Engineer + reviewer", async () => {
      vi.stubGlobal("fetch", vi.fn());

      const tool = getTool("paperclipGetTeamShape");
      const response = await tool.execute({ archetype: "rust-cargo" });

      const payload = JSON.parse(response.content[0]!.text);
      expect(payload.archetype).toBe("rust-cargo");
      expect(payload.shape.roles).toHaveLength(2);
      const eng = payload.shape.roles.find((r: { role: string }) => r.role === "engineer");
      expect(eng.name).toBe("Senior Engineer");
      expect(eng.profile).toBe("coding-heavy");
    });

    it("defaults to the unknown shape when no archetype is provided", async () => {
      vi.stubGlobal("fetch", vi.fn());

      const tool = getTool("paperclipGetTeamShape");
      const response = await tool.execute({});

      const payload = JSON.parse(response.content[0]!.text);
      expect(payload.archetype).toBe("unknown");
      expect(payload.shape.roles).toHaveLength(2);
    });

    it("returns all 7 shapes when includeAll=true", async () => {
      vi.stubGlobal("fetch", vi.fn());

      const tool = getTool("paperclipGetTeamShape");
      const response = await tool.execute({ includeAll: true });

      const payload = JSON.parse(response.content[0]!.text) as Array<unknown>;
      expect(Array.isArray(payload)).toBe(true);
      expect(payload).toHaveLength(7);
    });

    it("is annotated read-only and idempotent", () => {
      const tool = getTool("paperclipGetTeamShape");
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.idempotentHint).toBe(true);
      expect(tool.annotations?.destructiveHint).toBe(false);
    });

    it("makes no network calls — shape is resolved from the in-memory registry", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const tool = getTool("paperclipGetTeamShape");
      await tool.execute({ archetype: "go-modules" });

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("paperclipListPlugins (PL1)", () => {
    it("returns the full catalog when no filter is supplied", async () => {
      vi.stubGlobal("fetch", vi.fn());

      const tool = getTool("paperclipListPlugins");
      const response = await tool.execute({});

      const catalog = JSON.parse(response.content[0]!.text) as Array<{ id: string }>;
      expect(Array.isArray(catalog)).toBe(true);
      expect(catalog.length).toBeGreaterThanOrEqual(13);
    });

    it("makes no network calls (static catalog)", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const tool = getTool("paperclipListPlugins");
      await tool.execute({});

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("filters by category=notifications", async () => {
      vi.stubGlobal("fetch", vi.fn());

      const tool = getTool("paperclipListPlugins");
      const response = await tool.execute({ filter: { category: "notifications" } });

      const results = JSON.parse(response.content[0]!.text) as Array<{ id: string; category: string }>;
      expect(results.length).toBeGreaterThanOrEqual(1);
      for (const entry of results) {
        expect(entry.category).toBe("notifications");
      }
    });

    it("filters by tags=['slack']", async () => {
      vi.stubGlobal("fetch", vi.fn());

      const tool = getTool("paperclipListPlugins");
      const response = await tool.execute({ filter: { tags: ["slack"] } });

      const results = JSON.parse(response.content[0]!.text) as Array<{ id: string; tags: string[] }>;
      expect(results.length).toBeGreaterThanOrEqual(1);
      for (const entry of results) {
        expect(entry.tags).toContain("slack");
      }
    });

    it("filters by subscriptionCompatible=true returns all v1 entries", async () => {
      vi.stubGlobal("fetch", vi.fn());

      const tool = getTool("paperclipListPlugins");
      const unfiltered = await tool.execute({});
      const filtered = await tool.execute({ filter: { subscriptionCompatible: true } });

      const allCount = (JSON.parse(unfiltered.content[0]!.text) as unknown[]).length;
      const filteredCount = (JSON.parse(filtered.content[0]!.text) as unknown[]).length;
      expect(filteredCount).toBe(allCount);
    });

    it("returns empty array when no entries match the filter", async () => {
      vi.stubGlobal("fetch", vi.fn());

      const tool = getTool("paperclipListPlugins");
      const response = await tool.execute({ filter: { tags: ["nonexistent-tag-xyz-9999"] } });

      const results = JSON.parse(response.content[0]!.text) as unknown[];
      expect(results).toHaveLength(0);
    });

    it("is annotated as readOnly=true with no network side effects", () => {
      const tool = getTool("paperclipListPlugins");
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.destructiveHint).toBe(false);
    });
  });

  describe("paperclipDiagnoseCoverage", () => {
    it("hits GET /companies/:id/coverage using the default company id", async () => {
      const mockBody = {
        labelCounts: [{ label: "area:frontend", count: 4 }],
        coveredLabels: [],
        uncoveredLabels: [
          { label: "area:frontend", issueCount: 4, suggestedProfile: "coding-heavy" },
        ],
        summary: { openIssueCount: 4, coveredCount: 0, uncoveredCount: 1 },
      };
      const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse(mockBody));
      vi.stubGlobal("fetch", fetchMock);

      const tool = getTool("paperclipDiagnoseCoverage");
      const response = await tool.execute({});

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(String(url)).toBe(
        "http://localhost:3100/api/companies/11111111-1111-1111-1111-111111111111/coverage",
      );
      expect((init as RequestInit).method).toBe("GET");

      const payload = JSON.parse(response.content[0]!.text);
      expect(payload.uncoveredLabels).toHaveLength(1);
      expect(payload.uncoveredLabels[0].label).toBe("area:frontend");
      expect(payload.summary.uncoveredCount).toBe(1);
    });

    it("accepts an explicit companyId override", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        mockJsonResponse({ labelCounts: [], coveredLabels: [], uncoveredLabels: [], summary: { openIssueCount: 0, coveredCount: 0, uncoveredCount: 0 } }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const tool = getTool("paperclipDiagnoseCoverage");
      await tool.execute({ companyId: "99999999-9999-9999-9999-999999999999" });

      const [url] = fetchMock.mock.calls[0] as [string];
      expect(String(url)).toContain("/companies/99999999-9999-9999-9999-999999999999/coverage");
    });

    it("is annotated as READ_ONLY", () => {
      const tool = getTool("paperclipDiagnoseCoverage");
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.destructiveHint).toBe(false);
      expect(tool.annotations?.title).toBe("Diagnose team coverage");
    });
  });
});
