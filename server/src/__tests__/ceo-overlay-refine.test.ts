/**
 * S1 — CEO self-refinement overlay tests.
 *
 * Covers:
 * 1. History entry created before overwrite.
 * 2. Write succeeds after history capture.
 * 3. No-op when file not in proposedChanges.
 * 4. History directory is created even when overlay dir doesn't exist yet.
 * 5. Route: 404 when agentId has no projectId.
 * 6. Route: 404 when project has no workspace cwd.
 * 7. Route: happy path — writes file + history.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { refineCeoOverlayFiles } from "../services/ceo-overlay.js";

// ---------------------------------------------------------------------------
// Service unit tests
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-ceo-refine-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("refineCeoOverlayFiles", () => {
  it("writes the proposed file to the overlay directory", async () => {
    const result = await refineCeoOverlayFiles(tmpDir, {
      "AGENTS.md": "# Project-specific AGENTS",
    });

    expect(result.written).toContain("AGENTS.md");
    expect(result.repoPath).toBe(tmpDir);

    const content = await fs.readFile(
      path.join(tmpDir, ".paperclip", "ceo", "AGENTS.md"),
      "utf8",
    );
    expect(content).toBe("# Project-specific AGENTS");
  });

  it("creates a history entry before overwriting an existing file", async () => {
    const overlayDir = path.join(tmpDir, ".paperclip", "ceo");
    await fs.mkdir(overlayDir, { recursive: true });
    await fs.writeFile(path.join(overlayDir, "AGENTS.md"), "# Original content", "utf8");

    const result = await refineCeoOverlayFiles(tmpDir, {
      "AGENTS.md": "# Updated content",
    });

    expect(result.historyEntries).toHaveLength(1);
    expect(result.historyEntries[0]).toMatch(/AGENTS\.md$/);

    // History file should contain the previous content.
    const historyPath = path.join(overlayDir, ".history", result.historyEntries[0]!);
    const historyContent = await fs.readFile(historyPath, "utf8");
    expect(historyContent).toBe("# Original content");

    // Current file should have new content.
    const currentContent = await fs.readFile(path.join(overlayDir, "AGENTS.md"), "utf8");
    expect(currentContent).toBe("# Updated content");
  });

  it("does not create a history entry when there is no pre-existing file", async () => {
    const result = await refineCeoOverlayFiles(tmpDir, {
      "SOUL.md": "# New soul content",
    });

    expect(result.written).toContain("SOUL.md");
    expect(result.historyEntries).toHaveLength(0);
  });

  it("is a no-op for files not in proposedChanges", async () => {
    const overlayDir = path.join(tmpDir, ".paperclip", "ceo");
    await fs.mkdir(overlayDir, { recursive: true });
    await fs.writeFile(path.join(overlayDir, "TOOLS.md"), "# Original TOOLS", "utf8");

    // Only refine AGENTS.md — TOOLS.md should be untouched.
    await refineCeoOverlayFiles(tmpDir, {
      "AGENTS.md": "# New AGENTS",
    });

    const toolsContent = await fs.readFile(path.join(overlayDir, "TOOLS.md"), "utf8");
    expect(toolsContent).toBe("# Original TOOLS");
  });

  it("ignores unknown file names silently", async () => {
    const result = await refineCeoOverlayFiles(tmpDir, {
      "AGENTS.md": "# Valid",
      "MALICIOUS.md": "bad" as never,
    });

    expect(result.written).toEqual(["AGENTS.md"]);
  });

  it("handles multiple files in one call", async () => {
    const overlayDir = path.join(tmpDir, ".paperclip", "ceo");
    await fs.mkdir(overlayDir, { recursive: true });
    await fs.writeFile(path.join(overlayDir, "AGENTS.md"), "old AGENTS", "utf8");
    await fs.writeFile(path.join(overlayDir, "SOUL.md"), "old SOUL", "utf8");

    const result = await refineCeoOverlayFiles(tmpDir, {
      "AGENTS.md": "new AGENTS",
      "SOUL.md": "new SOUL",
      "TOOLS.md": "brand new TOOLS",
    });

    expect(result.written).toHaveLength(3);
    expect(result.historyEntries).toHaveLength(2); // Only files that existed before get history
  });
});

// ---------------------------------------------------------------------------
// Route integration tests
// ---------------------------------------------------------------------------

describe("POST /api/agents/:agentId/ceo-overlay/refine — route", () => {
  let tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await fs.rm(dir, { recursive: true, force: true });
    }
    tmpDirs = [];
    vi.resetModules();
    vi.clearAllMocks();
  });

  function makeRepoDir(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), "paperclip-s1-route-test-")).then((dir) => {
      tmpDirs.push(dir);
      return dir;
    });
  }

  async function buildApp(overrides: {
    agentRow?: Record<string, unknown> | null;
    workspaceRow?: Record<string, unknown> | null;
  } = {}) {
    const { ceoOverlayRoutes } = await import("../routes/ceo-overlay.js");

    const agentRow = overrides.agentRow !== undefined ? overrides.agentRow : { id: "agent-1", projectId: "project-1" };
    const workspaceRow = overrides.workspaceRow !== undefined ? overrides.workspaceRow : null;

    const db = {
      query: {
        agents: {
          findFirst: vi.fn().mockResolvedValue(agentRow),
        },
        projects: {
          findFirst: vi.fn().mockResolvedValue({ id: "project-1" }),
        },
      },
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                then: vi.fn().mockImplementation((cb: (rows: unknown[]) => unknown) =>
                  Promise.resolve(cb(workspaceRow ? [workspaceRow] : [])),
                ),
              }),
            }),
          }),
        }),
      }),
    };

    const app = express();
    app.use(express.json());
    // Inject board actor so assertBoard passes.
    app.use((req, _res, next) => {
      (req as unknown as Record<string, unknown>).actor = { type: "board", userId: "user-1", source: "local_implicit" };
      next();
    });
    app.use(ceoOverlayRoutes(db as never));
    app.use(errorHandler);
    return app;
  }

  it("returns 404 when agentId is not found", async () => {
    const app = await buildApp({ agentRow: null });
    const res = await request(app)
      .post("/agents/nonexistent-id/ceo-overlay/refine")
      .send({ proposedChanges: { "AGENTS.md": "# new" } });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("agent_not_found");
  });

  it("returns 404 when agent has no projectId", async () => {
    const app = await buildApp({ agentRow: { id: "agent-1", projectId: null } });
    const res = await request(app)
      .post("/agents/agent-1/ceo-overlay/refine")
      .send({ proposedChanges: { "AGENTS.md": "# new" } });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("agent_has_no_project");
  });

  it("returns 404 when project has no workspace cwd", async () => {
    const app = await buildApp({
      agentRow: { id: "agent-1", projectId: "project-1" },
      workspaceRow: null,
    });
    const res = await request(app)
      .post("/agents/agent-1/ceo-overlay/refine")
      .send({ proposedChanges: { "AGENTS.md": "# new" } });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("project_has_no_workspace_cwd");
  });

  it("writes the file and returns written + historyEntries on success", async () => {
    const repoDir = await makeRepoDir();
    const app = await buildApp({
      agentRow: { id: "agent-1", projectId: "project-1" },
      workspaceRow: { cwd: repoDir, isPrimary: true, createdAt: new Date().toISOString() },
    });

    const res = await request(app)
      .post("/agents/agent-1/ceo-overlay/refine")
      .send({ proposedChanges: { "AGENTS.md": "# project-specific" } });

    expect(res.status).toBe(200);
    expect(res.body.written).toContain("AGENTS.md");
    expect(Array.isArray(res.body.historyEntries)).toBe(true);
    expect(res.body.repoPath).toBe(repoDir);

    const content = await fs.readFile(
      path.join(repoDir, ".paperclip", "ceo", "AGENTS.md"),
      "utf8",
    );
    expect(content).toBe("# project-specific");
  });

  it("creates history entry on second call to same file", async () => {
    const repoDir = await makeRepoDir();
    const app = await buildApp({
      agentRow: { id: "agent-1", projectId: "project-1" },
      workspaceRow: { cwd: repoDir, isPrimary: true, createdAt: new Date().toISOString() },
    });

    // First write — no history.
    await request(app)
      .post("/agents/agent-1/ceo-overlay/refine")
      .send({ proposedChanges: { "AGENTS.md": "# version 1" } });

    // Second write — should create history entry for version 1.
    const res2 = await request(app)
      .post("/agents/agent-1/ceo-overlay/refine")
      .send({ proposedChanges: { "AGENTS.md": "# version 2" } });

    expect(res2.status).toBe(200);
    expect(res2.body.historyEntries).toHaveLength(1);

    const historyDir = path.join(repoDir, ".paperclip", "ceo", ".history");
    const historyFile = res2.body.historyEntries[0];
    const historyContent = await fs.readFile(path.join(historyDir, historyFile), "utf8");
    expect(historyContent).toBe("# version 1");
  });
});
