import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaperclipApiClient } from "./client.js";
import { createToolDefinitions } from "./tools.js";

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

  describe("paperclipBootstrapApp", () => {
    it("writes .paperclip/ceo/AGENTS.md with hiring-standard block by default", async () => {
      const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "pclip-bootstrap-test-"));
      try {
        vi.stubGlobal(
          "fetch",
          vi.fn().mockResolvedValue(mockJsonResponse({ id: "proj-uuid-1", name: "My App" })),
        );

        const tool = getTool("paperclipBootstrapApp");
        const response = await tool.execute({
          name: "My App",
          repoPath,
          defaultHiringProfile: "engineer",
          autoReviewEnabled: true,
        });

        const result = JSON.parse(response.content[0]?.text ?? "{}");
        expect(result.overlayWritten).toBe(true);

        const overlayFile = path.join(repoPath, ".paperclip", "ceo", "AGENTS.md");
        expect(fs.existsSync(overlayFile)).toBe(true);

        const contents = fs.readFileSync(overlayFile, "utf8");
        expect(contents).toContain("# Project-specific CEO instructions — My App");
        expect(contents).toContain('profile: "engineer"');
        expect(contents).toContain('profile: "reviewer"');
        expect(contents).toContain("autoReviewEnabled: true");
      } finally {
        fs.rmSync(repoPath, { recursive: true, force: true });
      }
    });

    it("skips writing the overlay when writeCeoOverlay is false", async () => {
      const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "pclip-bootstrap-test-"));
      try {
        vi.stubGlobal(
          "fetch",
          vi.fn().mockResolvedValue(mockJsonResponse({ id: "proj-uuid-2", name: "No Overlay" })),
        );

        const tool = getTool("paperclipBootstrapApp");
        const response = await tool.execute({
          name: "No Overlay",
          repoPath,
          writeCeoOverlay: false,
        });

        const result = JSON.parse(response.content[0]?.text ?? "{}");
        expect(result.overlayWritten).toBe(false);

        const overlayFile = path.join(repoPath, ".paperclip", "ceo", "AGENTS.md");
        expect(fs.existsSync(overlayFile)).toBe(false);
      } finally {
        fs.rmSync(repoPath, { recursive: true, force: true });
      }
    });

    it("reports a warning but does not abort when the overlay directory is not writable", async () => {
      // Create a file at the directory path so mkdirSync fails (ENOTDIR / EEXIST as file)
      const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "pclip-bootstrap-test-"));
      try {
        // Place a regular file where the ceo directory would be
        const ceoDirPath = path.join(repoPath, ".paperclip", "ceo");
        fs.mkdirSync(path.dirname(ceoDirPath), { recursive: true });
        fs.writeFileSync(ceoDirPath, "i am a file, not a directory");

        vi.stubGlobal(
          "fetch",
          vi.fn().mockResolvedValue(mockJsonResponse({ id: "proj-uuid-3", name: "Blocked" })),
        );

        const tool = getTool("paperclipBootstrapApp");
        const response = await tool.execute({
          name: "Blocked",
          repoPath,
          writeCeoOverlay: true,
        });

        const result = JSON.parse(response.content[0]?.text ?? "{}");
        // Bootstrap must succeed (project returned), overlay write failed gracefully
        expect(result.project?.id).toBe("proj-uuid-3");
        expect(result.overlayWritten).toBe(false);
        expect(typeof result.overlayWarning).toBe("string");
        expect(result.overlayWarning.length).toBeGreaterThan(0);
      } finally {
        fs.rmSync(repoPath, { recursive: true, force: true });
      }
    });
  });
});
