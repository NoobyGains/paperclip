import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaperclipApiClient } from "./client.js";
import { createResourceDefinitions } from "./resources.js";

function makeClient() {
  return new PaperclipApiClient({
    apiUrl: "http://localhost:3100/api",
    apiKey: "token-abc",
    companyId: "11111111-1111-1111-1111-111111111111",
    agentId: "22222222-2222-2222-2222-222222222222",
    runId: null,
  });
}

function mockJsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockTextResponse(text: string, status = 200) {
  return new Response(text, {
    status,
    headers: { "Content-Type": "text/plain" },
  });
}

function findResource(name: string) {
  const resource = createResourceDefinitions(makeClient()).find((r) => r.name === name);
  if (!resource) throw new Error(`missing resource ${name}`);
  return resource;
}

describe("paperclip MCP resources", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("reads the company summary JSON from /companies/:id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({
        id: "company-1",
        name: "Paperclip",
        status: "active",
        requireBoardApprovalForNewAgents: true,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const text = await findResource("Company summary").read();
    const payload = JSON.parse(text);
    expect(payload.name).toBe("Paperclip");
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(String(url)).toBe(
      "http://localhost:3100/api/companies/11111111-1111-1111-1111-111111111111",
    );
  });

  it("reads open issues with the status=in_progress filter", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse([{ id: "issue-1" }]));
    vi.stubGlobal("fetch", fetchMock);

    await findResource("Open issues").read();
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(String(url)).toContain("/issues?status=in_progress");
  });

  it("stuck diagnostics resource runs the diagnose-company flow", async () => {
    const fetchMock = vi.fn().mockImplementation((url: URL | string) => {
      const path = String(url);
      if (path.endsWith("/api/companies/11111111-1111-1111-1111-111111111111")) {
        return Promise.resolve(
          mockJsonResponse({
            id: "11111111-1111-1111-1111-111111111111",
            name: "Paperclip",
            status: "active",
            pauseReason: null,
            budgetMonthlyCents: 100000,
            spentMonthlyCents: 500,
          }),
        );
      }
      if (path.includes("/agents") && !path.includes("issues")) {
        return Promise.resolve(
          mockJsonResponse([
            { id: "agent-1", name: "CEO", status: "paused", pauseReason: "budget" },
            { id: "agent-2", name: "CTO", status: "idle", pauseReason: null },
          ]),
        );
      }
      if (path.includes("/approvals?status=pending")) {
        return Promise.resolve(mockJsonResponse([]));
      }
      if (path.includes("/issues?status=in_progress")) {
        return Promise.resolve(mockJsonResponse([]));
      }
      if (path.endsWith("/routines")) {
        return Promise.resolve(mockJsonResponse([]));
      }
      return Promise.resolve(mockJsonResponse({}));
    });
    vi.stubGlobal("fetch", fetchMock);

    const text = await findResource("Stuck diagnostics").read();
    const payload = JSON.parse(text);
    expect(payload.summary.pausedAgentCount).toBe(1);
    expect(payload.pausedAgents[0].name).toBe("CEO");
  });

  it("operator guide resource fetches /llms/operator-context.txt (not /api)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockTextResponse("# Operator Guide\n\nHi"));
    vi.stubGlobal("fetch", fetchMock);

    const text = await findResource("Operator guide").read();
    expect(text).toContain("# Operator Guide");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe("http://localhost:3100/llms/operator-context.txt");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer token-abc");
  });

  // Smoke test: mutate state between two read() calls and assert the second reflects the change.
  // This proves read() goes to the network every time rather than returning a cached value.
  it("smoke — agents resource reflects live state on each read() call", async () => {
    const client = makeClient();
    const resource = createResourceDefinitions(client).find((r) => r.name === "Agents");
    if (!resource) throw new Error("Agents resource not found");

    // First read: one agent
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse([{ id: "agent-1", name: "CEO", status: "active" }]),
      )
      // Second read: two agents (simulates a hire happening between the two reads)
      .mockResolvedValueOnce(
        mockJsonResponse([
          { id: "agent-1", name: "CEO", status: "active" },
          { id: "agent-2", name: "CTO", status: "idle" },
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);

    const first = JSON.parse(await resource.read()) as Array<unknown>;
    expect(first).toHaveLength(1);

    const second = JSON.parse(await resource.read()) as Array<unknown>;
    expect(second).toHaveLength(2);

    // Two network calls — one per read(), proving no in-memory cache
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("setup recipe resource fetches /llms/setup-recipe.txt and appends plugin section", async () => {
    const recipeBody = [
      "# Paperclip Setup Recipe",
      "",
      "You are onboarding projects for this operator.",
      "",
      "## Operator context",
      "",
      "Billing mode: **subscription-only (no API billing)**",
      "",
      "## Canonical onboarding recipe",
      "",
      "For each project: call `paperclipOnboardPortfolio` with the repo path",
    ].join("\n");

    const fetchMock = vi.fn().mockImplementation((url: URL | string) => {
      const u = String(url);
      if (u.includes("/llms/setup-recipe.txt")) {
        return Promise.resolve(mockTextResponse(recipeBody));
      }
      if (u.includes("/api/me/profile")) {
        return Promise.resolve(mockJsonResponse({ subscriptionOnly: true }));
      }
      return Promise.resolve(mockJsonResponse({}));
    });
    vi.stubGlobal("fetch", fetchMock);

    const text = await findResource("Setup recipe").read();
    expect(text).toContain("# Paperclip Setup Recipe");
    expect(text).toContain("paperclipOnboardPortfolio");
    expect(text).toContain("subscription-only");
    // Plugin section should be appended
    expect(text).toContain("## Plugins relevant to your setup");
    expect(text).toContain("paperclip://plugins");

    const urls = fetchMock.mock.calls.map((args) => String(args[0]));
    expect(urls.some((u) => u.includes("/llms/setup-recipe.txt"))).toBe(true);
  });

  it("plugin catalog resource returns all catalog entries as JSON", async () => {
    const text = await findResource("Plugin catalog").read();
    const catalog = JSON.parse(text) as Array<{ id: string }>;
    expect(Array.isArray(catalog)).toBe(true);
    expect(catalog.length).toBeGreaterThanOrEqual(13);
    const ids = catalog.map((e) => e.id);
    expect(ids).toContain("paperclip-plugin-slack");
    expect(ids).toContain("paperclip-plugin-discord");
    expect(ids).toContain("paperclip-plugin-hindsight");
  });

  it("plugin catalog resource requires no network calls (static data)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await findResource("Plugin catalog").read();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("recommended plugins resource fetches operator profile and returns ranked entries", async () => {
    const fetchMock = vi.fn().mockImplementation((url: URL | string) => {
      const u = String(url);
      if (u.includes("/api/me/profile")) {
        return Promise.resolve(
          mockJsonResponse({
            subscriptionOnly: false,
            preferences: { notes: "we use slack" },
          }),
        );
      }
      return Promise.resolve(mockJsonResponse({}));
    });
    vi.stubGlobal("fetch", fetchMock);

    const text = await findResource("Recommended plugins").read();
    const results = JSON.parse(text) as Array<{ id: string }>;
    expect(Array.isArray(results)).toBe(true);
    const ids = results.map((e) => e.id);
    // slack preference → slack plugin should appear
    expect(ids).toContain("paperclip-plugin-slack");
  });

  it("recommended plugins resource falls back gracefully when profile fetch fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const text = await findResource("Recommended plugins").read();
    const results = JSON.parse(text) as Array<{ id: string }>;
    // Should still return something (null profile uses default scoring)
    expect(Array.isArray(results)).toBe(true);
  });

  describe("R1 — paperclip://archetypes resource", () => {
    it("is present in the resource list with the correct URI and mimeType", () => {
      const resources = createResourceDefinitions(makeClient());
      const r = resources.find((res) => res.uri === "paperclip://archetypes");
      expect(r).toBeDefined();
      expect(r!.mimeType).toBe("application/json");
    });

    it("read() returns valid JSON with all 7 archetype stacks", async () => {
      // No network needed — pure in-memory registry
      const text = await findResource("Archetypes").read();
      const entries = JSON.parse(text) as Array<{ stack: string; shape: unknown }>;
      expect(Array.isArray(entries)).toBe(true);
      expect(entries).toHaveLength(7);
      const stacks = entries.map((e) => e.stack).sort();
      expect(stacks).toEqual([
        "dotnet",
        "go-modules",
        "npm-single",
        "pnpm-monorepo",
        "python-poetry",
        "rust-cargo",
        "unknown",
      ]);
    });

    it("read() does not make any network calls", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await findResource("Archetypes").read();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("pnpm-monorepo shape includes cto, two engineers, qa, and reviewer slots", async () => {
      const text = await findResource("Archetypes").read();
      const entries = JSON.parse(text) as Array<{ stack: string; shape: { roles: Array<{ role: string; profile: string }> } }>;
      const entry = entries.find((e) => e.stack === "pnpm-monorepo");
      expect(entry).toBeDefined();
      const roles = entry!.shape.roles.map((r) => r.role);
      expect(roles).toContain("cto");
      expect(roles).toContain("qa");
      expect(roles).toContain("reviewer");
      expect(roles.filter((r) => r === "engineer")).toHaveLength(2);
    });
  });
});
