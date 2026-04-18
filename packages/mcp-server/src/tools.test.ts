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

  it("paperclipBootstrapApp chains create-company → patch settings → create CEO → create project", async () => {
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
        });
      }
      if (method === "POST" && u.includes("/api/companies/c-1/agents")) {
        return mockJsonResponse({ id: "ceo-1", name: "CEO", adapterType: "claude_local" });
      }
      if (method === "POST" && u.includes("/api/companies/c-1/projects")) {
        return mockJsonResponse({ id: "proj-1", name: "My App", workspace: {} });
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
    expect(payload.ceo.id).toBe("ceo-1");
    expect(payload.project.id).toBe("proj-1");

    // Ordering: company → patch → agent → project
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toContain("/api/companies");
    expect(calls[1]?.method).toBe("PATCH");
    expect(calls[1]?.body).toMatchObject({
      autoHireEnabled: true,
      requireBoardApprovalForNewAgents: false,
    });
    expect(calls[2]?.url).toContain("/api/companies/c-1/agents");
    expect(calls[3]?.url).toContain("/api/companies/c-1/projects");
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
});
