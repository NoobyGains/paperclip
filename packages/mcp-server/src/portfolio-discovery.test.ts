import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  discoverProjects,
  normaliseRemoteUrl,
  scanGitHubRepos,
  scanLocalProjects,
} from "./portfolio-discovery.js";

// ---------------------------------------------------------------------------
// Fixture path
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The fixtures live at packages/mcp-server/tests/fixtures/portfolio/
const FIXTURE_ROOT = path.resolve(__dirname, "../tests/fixtures/portfolio");

// ---------------------------------------------------------------------------
// normaliseRemoteUrl
// ---------------------------------------------------------------------------

describe("normaliseRemoteUrl", () => {
  it("normalises HTTPS URL (strips .git suffix)", () => {
    expect(normaliseRemoteUrl("https://github.com/acme/alpha.git")).toBe(
      "github.com/acme/alpha",
    );
  });

  it("normalises SSH shorthand to the same canonical form", () => {
    expect(normaliseRemoteUrl("git@github.com:acme/alpha.git")).toBe(
      "github.com/acme/alpha",
    );
  });

  it("treats SSH and HTTPS variants as equal", () => {
    const https = normaliseRemoteUrl("https://github.com/acme/repo.git");
    const ssh = normaliseRemoteUrl("git@github.com:acme/repo.git");
    expect(https).toBe(ssh);
  });

  it("handles URLs without .git suffix gracefully", () => {
    expect(normaliseRemoteUrl("https://github.com/acme/repo")).toBe(
      "github.com/acme/repo",
    );
  });
});

// ---------------------------------------------------------------------------
// scanLocalProjects
// ---------------------------------------------------------------------------

describe("scanLocalProjects", () => {
  it("finds all three fixture repos", async () => {
    const results = await scanLocalProjects(FIXTURE_ROOT);
    const names = results.map((r) => r.name).sort();
    expect(names).toEqual(["alpha-app", "beta-service", "gamma"]);
  });

  it("resolves package.json name for alpha", async () => {
    const results = await scanLocalProjects(FIXTURE_ROOT);
    const alpha = results.find((r) => r.name === "alpha-app");
    expect(alpha).toBeDefined();
    expect(alpha!.repoPath).toContain("alpha");
  });

  it("reads HTTPS remote for alpha", async () => {
    const results = await scanLocalProjects(FIXTURE_ROOT);
    const alpha = results.find((r) => r.name === "alpha-app");
    expect(alpha!.remote).toBe("https://github.com/acme/alpha.git");
  });

  it("reads SSH remote for beta", async () => {
    const results = await scanLocalProjects(FIXTURE_ROOT);
    const beta = results.find((r) => r.name === "beta-service");
    expect(beta!.remote).toBe("git@github.com:acme/beta.git");
  });

  it("falls back to directory name when no package.json (gamma)", async () => {
    const results = await scanLocalProjects(FIXTURE_ROOT);
    const gamma = results.find((r) => r.name === "gamma");
    expect(gamma).toBeDefined();
    expect(gamma!.remote).toBeUndefined();
  });

  it("repoPath is an absolute path", async () => {
    const results = await scanLocalProjects(FIXTURE_ROOT);
    for (const r of results) {
      expect(path.isAbsolute(r.repoPath)).toBe(true);
    }
  });

  it("throws a descriptive error for a missing rootPath", async () => {
    await expect(scanLocalProjects("/nonexistent/path/xyz")).rejects.toThrow(
      /Cannot read rootPath/,
    );
  });
});

// ---------------------------------------------------------------------------
// scanGitHubRepos (mocked)
// ---------------------------------------------------------------------------

describe("scanGitHubRepos", () => {
  it("maps GitHub API response to GitHubRepo array", async () => {
    const mockResponse = [
      {
        name: "cool-project",
        owner: { login: "acme" },
        html_url: "https://github.com/acme/cool-project",
        description: "A cool project",
      },
      {
        name: "other-repo",
        owner: { login: "acme" },
        html_url: "https://github.com/acme/other-repo",
        description: null,
      },
    ];
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const repos = await scanGitHubRepos({ owner: "acme", fetchFn });
    expect(repos).toHaveLength(2);
    expect(repos[0]).toMatchObject({
      name: "cool-project",
      owner: "acme",
      url: "https://github.com/acme/cool-project",
      description: "A cool project",
    });
    // null description should be omitted
    expect(repos[1]?.description).toBeUndefined();
  });

  it("throws on non-OK HTTP status", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response("Not Found", { status: 404 }),
    );
    await expect(scanGitHubRepos({ owner: "ghost", fetchFn })).rejects.toThrow(
      /GitHub API error 404/,
    );
  });

  it("uses Authorization header when GITHUB_TOKEN is set", async () => {
    const token = "ghp_test_token_abc";
    const originalToken = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = token;

    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await scanGitHubRepos({ owner: "acme", fetchFn });

    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      `Bearer ${token}`,
    );

    // Restore
    if (originalToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalToken;
    }
  });
});

// ---------------------------------------------------------------------------
// discoverProjects (integration-style, mocked GitHub)
// ---------------------------------------------------------------------------

describe("discoverProjects", () => {
  it("returns local repos from fixture dir with no GitHub option", async () => {
    const result = await discoverProjects({ rootPath: FIXTURE_ROOT });
    expect(result.local).toHaveLength(3);
    expect(result.github).toHaveLength(0);
    expect(result.dedupedTotal).toBe(3);
  });

  it("deduplicates GitHub repos that match a local remote (HTTPS vs SSH)", async () => {
    // alpha has HTTPS remote https://github.com/acme/alpha.git
    // beta has SSH remote git@github.com:acme/beta.git
    // GitHub returns both — they should be deduped away.
    const mockGitHub = [
      {
        name: "alpha",
        owner: { login: "acme" },
        html_url: "https://github.com/acme/alpha",
        description: null,
      },
      {
        name: "beta",
        owner: { login: "acme" },
        html_url: "https://github.com/acme/beta",
        description: null,
      },
      {
        name: "delta",
        owner: { login: "acme" },
        html_url: "https://github.com/acme/delta",
        description: "Net new project",
      },
    ];

    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockGitHub), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await discoverProjects({
      rootPath: FIXTURE_ROOT,
      github: { owner: "acme", fetchFn },
    });

    // 3 local + 1 net-new GitHub (delta) — alpha and beta deduped
    expect(result.local).toHaveLength(3);
    expect(result.github).toHaveLength(1);
    expect(result.github[0]?.name).toBe("delta");
    expect(result.dedupedTotal).toBe(4);
  });

  it("handles invalid rootPath gracefully — sets localError, returns empty local array", async () => {
    const result = await discoverProjects({ rootPath: "/no/such/directory" });
    // local is an empty array; the error is surfaced via localError
    expect(Array.isArray(result.local)).toBe(true);
    expect(result.local).toHaveLength(0);
    expect(result.localError).toMatch(/Cannot read rootPath/);
    expect(result.github).toHaveLength(0);
    expect(result.dedupedTotal).toBe(0);
  });

  it("does not call GitHub API when github option is omitted", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await discoverProjects({ rootPath: FIXTURE_ROOT });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// MCP tool surface (via tools.ts)
// ---------------------------------------------------------------------------

describe("paperclipDiscoverProjects MCP tool", () => {
  it("is registered with readOnlyHint=true and openWorldHint=true", async () => {
    const { PaperclipApiClient } = await import("./client.js");
    const { createToolDefinitions } = await import("./tools.js");

    const client = new PaperclipApiClient({
      apiUrl: "http://localhost:3100/api",
      apiKey: "token-test",
      companyId: "11111111-1111-1111-1111-111111111111",
      agentId: null,
      runId: null,
    });

    const tool = createToolDefinitions(client).find(
      (t) => t.name === "paperclipDiscoverProjects",
    );

    expect(tool).toBeDefined();
    expect(tool!.annotations?.readOnlyHint).toBe(true);
    expect(tool!.annotations?.openWorldHint).toBe(true);
    expect(tool!.annotations?.destructiveHint).toBe(false);
  });

  it("returns local projects when called with fixture rootPath", async () => {
    const { PaperclipApiClient } = await import("./client.js");
    const { createToolDefinitions } = await import("./tools.js");

    const client = new PaperclipApiClient({
      apiUrl: "http://localhost:3100/api",
      apiKey: "token-test",
      companyId: "11111111-1111-1111-1111-111111111111",
      agentId: null,
      runId: null,
    });

    const tool = createToolDefinitions(client).find(
      (t) => t.name === "paperclipDiscoverProjects",
    )!;

    const response = await tool.execute({ rootPath: FIXTURE_ROOT });
    expect(response.isError).toBeFalsy();

    const payload = JSON.parse(response.content[0]!.text) as {
      local: unknown[];
      github: unknown[];
      dedupedTotal: number;
    };
    expect(payload.local).toHaveLength(3);
    expect(payload.github).toHaveLength(0);
    expect(payload.dedupedTotal).toBe(3);
  });
});
