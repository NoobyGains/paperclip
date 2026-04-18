import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseSetupArgs, runSetup } from "./setup.js";

function mockJsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("setup CLI arg parser", () => {
  it("returns null when --setup is absent", () => {
    expect(parseSetupArgs(["foo", "bar"])).toBeNull();
  });

  it("parses --setup <url>", () => {
    const opts = parseSetupArgs(["--setup", "http://localhost:3100"]);
    expect(opts?.paperclipBaseUrl).toBe("http://localhost:3100");
  });

  it("parses --company and --no-browser alongside --setup", () => {
    const opts = parseSetupArgs([
      "--setup",
      "http://paperclip.example",
      "--company",
      "company-1",
      "--no-browser",
    ]);
    expect(opts?.companyId).toBe("company-1");
    expect(opts?.skipOpenBrowser).toBe(true);
  });
});

describe("runSetup end-to-end (mocked transport)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("polls until approved, resolves company, and prints a .mcp.json snippet", async () => {
    const logs: string[] = [];
    const errors: string[] = [];

    let pollCount = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: URL | string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/api/cli-auth/challenges") && init?.method === "POST") {
        return mockJsonResponse({
          id: "challenge-1",
          token: "tok-abc",
          boardApiToken: "board-key-xyz",
          approvalPath: "/cli-auth/challenge-1?token=tok-abc",
          approvalUrl: "http://localhost:3100/cli-auth/challenge-1?token=tok-abc",
          pollPath: "/cli-auth/challenges/challenge-1",
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        });
      }
      if (u.includes("/api/cli-auth/challenges/challenge-1")) {
        pollCount++;
        return mockJsonResponse({
          id: "challenge-1",
          status: pollCount >= 2 ? "approved" : "pending",
        });
      }
      if (u.endsWith("/api/companies")) {
        return mockJsonResponse([
          { id: "company-uuid-1", name: "Paperclip HQ" },
        ]);
      }
      throw new Error(`Unmocked fetch: ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const code = await runSetup({
      paperclipBaseUrl: "http://localhost:3100",
      pollIntervalMs: 1,
      pollTimeoutMs: 5_000,
      skipOpenBrowser: true,
      stdout: (line) => logs.push(line),
      stderr: (line) => errors.push(line),
    });

    expect(code).toBe(0);
    const combined = logs.join("\n");
    expect(combined).toContain('"PAPERCLIP_API_URL": "http://localhost:3100"');
    expect(combined).toContain('"PAPERCLIP_API_KEY": "board-key-xyz"');
    expect(combined).toContain('"PAPERCLIP_COMPANY_ID": "company-uuid-1"');
    expect(errors).toHaveLength(0);
  });

  it("reports a clear error when approval times out", async () => {
    const logs: string[] = [];
    const errors: string[] = [];

    const fetchMock = vi.fn().mockImplementation(async (url: URL | string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/api/cli-auth/challenges") && init?.method === "POST") {
        return mockJsonResponse({
          id: "challenge-2",
          token: "tok",
          boardApiToken: "key",
          approvalPath: "/cli-auth/challenge-2?token=tok",
          approvalUrl: "http://localhost:3100/cli-auth/challenge-2?token=tok",
          pollPath: "/cli-auth/challenges/challenge-2",
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        });
      }
      if (u.includes("/api/cli-auth/challenges/challenge-2")) {
        return mockJsonResponse({ id: "challenge-2", status: "pending" });
      }
      throw new Error(`Unmocked fetch: ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const code = await runSetup({
      paperclipBaseUrl: "http://localhost:3100",
      pollIntervalMs: 1,
      pollTimeoutMs: 20,
      skipOpenBrowser: true,
      stdout: (line) => logs.push(line),
      stderr: (line) => errors.push(line),
    });

    expect(code).toBe(2);
    expect(errors.join("\n")).toContain("Timed out");
  });
});
