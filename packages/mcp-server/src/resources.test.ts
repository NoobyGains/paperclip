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
});
