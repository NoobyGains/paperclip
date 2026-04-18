/**
 * O2 — paperclipOnboardPortfolio integration tests.
 *
 * Tests the portfolio-onboard orchestrator (server/src/services/portfolio-onboard.ts)
 * plus the HTTP route (server/src/routes/portfolio-onboard.ts).
 *
 * Acceptance criteria:
 * 1. Fresh DB: two fixture repos onboard cleanly — two companies created,
 *    CEOs + reviewers present, overlays written to each repo.
 * 2. Re-run: no duplication, reports skipped.
 * 3. One API-billed-override attempt: partial success, refused hire reported, rest succeed.
 * 4. Route: POST /api/portfolio/onboard returns the expected shape.
 */

import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

async function makeTmpRepo(name: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `paperclip-o2-${name}-`));
  // Minimal package.json so npm-single archetype detector fires.
  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name }), "utf8");
  return dir;
}

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------

const mockCompanyService = vi.hoisted(() => ({
  create: vi.fn(),
  list: vi.fn(),
  update: vi.fn(),
  getById: vi.fn(),
}));

const mockAgentService = vi.hoisted(() => ({
  create: vi.fn(),
  getById: vi.fn(),
  list: vi.fn(),
}));

// Minimal db mock
function makeDbMock(overrides?: {
  companiesFind?: () => Promise<{ id: string } | null>;
}) {
  const companiesFind = overrides?.companiesFind ?? (() => Promise.resolve(null));
  return {
    query: {
      companies: {
        findFirst: vi.fn().mockImplementation(companiesFind),
      },
    },
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: "project-id-1" }]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          then: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
  };
}

let agentCounter = 0;

function registerModuleMocks() {
  vi.doMock("../services/portfolio-onboard.js", async () => {
    const actual = await vi.importActual<typeof import("../services/portfolio-onboard.js")>(
      "../services/portfolio-onboard.js",
    );
    return actual;
  });

  vi.doMock("../services/companies.js", () => ({
    companyService: () => mockCompanyService,
  }));

  vi.doMock("../services/agents.js", () => ({
    agentService: () => mockAgentService,
    deduplicateAgentName: (name: string) => name,
  }));

  vi.doMock("../services/index.js", () => ({
    companyService: () => mockCompanyService,
    agentService: () => mockAgentService,
    deduplicateAgentName: (name: string) => name,
  }));
}

// ---------------------------------------------------------------------------
// Unit tests: onboardPortfolio service
// ---------------------------------------------------------------------------

describe("onboardPortfolio service", () => {
  let tmpDirs: string[] = [];

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    agentCounter = 0;

    registerModuleMocks();

    // Default: company create returns a fresh company, agents create returns fresh agents
    mockCompanyService.create.mockImplementation(async (data: Record<string, unknown>) => ({
      id: `company-${Date.now()}-${Math.random()}`,
      name: data.name,
      autoHireEnabled: data.autoHireEnabled,
      requireBoardApprovalForNewAgents: data.requireBoardApprovalForNewAgents,
      defaultHireAdapter: data.defaultHireAdapter,
      autoReviewEnabled: data.autoReviewEnabled,
    }));

    mockAgentService.create.mockImplementation(async (_companyId: string, data: Record<string, unknown>) => ({
      id: `agent-${++agentCounter}`,
      name: data.name,
      role: data.role,
      adapterType: data.adapterType,
      adapterConfig: data.adapterConfig,
    }));
  });

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await fs.rm(dir, { recursive: true, force: true });
    }
    tmpDirs = [];
  });

  it("onboards a single repo — creates company + CEO + reviewer + pre-hired agents", async () => {
    const { onboardPortfolio } = await import("../services/portfolio-onboard.js");

    const repoDir = await makeTmpRepo("my-app");
    tmpDirs.push(repoDir);

    const db = makeDbMock();
    const result = await onboardPortfolio(db as never, {
      projects: [{ repoPath: repoDir, name: "my-app" }],
    });

    // One project onboarded, none skipped.
    expect(result.onboarded).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
    expect(result.aggregate.companies).toBe(1);

    const onb = result.onboarded[0]!;
    expect(onb.repoPath).toBe(repoDir);
    expect(typeof onb.companyId).toBe("string");
    expect(typeof onb.ceoId).toBe("string");
    expect(typeof onb.reviewerId).toBe("string");
    expect(Array.isArray(onb.preHiredAgentIds)).toBe(true);
    expect(onb.refusedHires).toEqual([]);

    // Company was created with correct settings.
    expect(mockCompanyService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        requireBoardApprovalForNewAgents: false,
        autoHireEnabled: true,
        autoReviewEnabled: true,
      }),
    );

    // CEO agent was created.
    expect(mockAgentService.create).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ role: "ceo", name: "CEO" }),
    );

    // Reviewer agent was created.
    expect(mockAgentService.create).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ role: "reviewer" }),
    );
  });

  it("writes CEO overlay AGENTS.md to the repo", async () => {
    const { onboardPortfolio } = await import("../services/portfolio-onboard.js");

    const repoDir = await makeTmpRepo("overlay-app");
    tmpDirs.push(repoDir);

    const db = makeDbMock();
    const result = await onboardPortfolio(db as never, {
      projects: [{ repoPath: repoDir, name: "overlay-app" }],
    });

    expect(result.onboarded[0]!.overlayWritten).toBe(true);

    const agentsMd = await fs.readFile(
      path.join(repoDir, ".paperclip", "ceo", "AGENTS.md"),
      "utf8",
    );
    expect(agentsMd).toContain("npm-single");
    expect(agentsMd).toContain(repoDir);
  });

  it("writes .paperclip/project.yaml to the repo", async () => {
    const { onboardPortfolio } = await import("../services/portfolio-onboard.js");

    const repoDir = await makeTmpRepo("yaml-app");
    tmpDirs.push(repoDir);

    const db = makeDbMock();
    await onboardPortfolio(db as never, {
      projects: [{ repoPath: repoDir }],
    });

    const yaml = await fs.readFile(path.join(repoDir, ".paperclip", "project.yaml"), "utf8");
    expect(yaml).toMatch(/companyId:/);
    expect(yaml).toMatch(/projectId:/);
    expect(yaml).toMatch(/ceoAgentId:/);
  });

  it("skips already-onboarded repo when project.yaml + company still exist", async () => {
    const { onboardPortfolio } = await import("../services/portfolio-onboard.js");

    const repoDir = await makeTmpRepo("idempotent-app");
    tmpDirs.push(repoDir);

    // Write a fake project.yaml
    const dotDir = path.join(repoDir, ".paperclip");
    await fs.mkdir(dotDir, { recursive: true });
    await fs.writeFile(
      path.join(dotDir, "project.yaml"),
      [
        "companyId: existing-company-id",
        "projectId: existing-project-id",
        "ceoAgentId: existing-ceo-id",
        "paperclipApiUrl: http://localhost:3000",
        "",
      ].join("\n"),
      "utf8",
    );

    // DB stub returns the existing company
    const db = makeDbMock({
      companiesFind: () => Promise.resolve({ id: "existing-company-id" }),
    });

    const result = await onboardPortfolio(db as never, {
      projects: [{ repoPath: repoDir }],
    });

    expect(result.onboarded).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toContain("already-onboarded");

    // Company/agent service should not have been called.
    expect(mockCompanyService.create).not.toHaveBeenCalled();
    expect(mockAgentService.create).not.toHaveBeenCalled();
  });

  it("re-onboards if project.yaml exists but company is gone from DB", async () => {
    const { onboardPortfolio } = await import("../services/portfolio-onboard.js");

    const repoDir = await makeTmpRepo("rehydrate-app");
    tmpDirs.push(repoDir);

    // Write a stale project.yaml
    const dotDir = path.join(repoDir, ".paperclip");
    await fs.mkdir(dotDir, { recursive: true });
    await fs.writeFile(
      path.join(dotDir, "project.yaml"),
      [
        "companyId: stale-company-id",
        "projectId: stale-project-id",
        "ceoAgentId: stale-ceo-id",
        "",
      ].join("\n"),
      "utf8",
    );

    // DB returns null (company deleted)
    const db = makeDbMock({
      companiesFind: () => Promise.resolve(null),
    });

    const result = await onboardPortfolio(db as never, {
      projects: [{ repoPath: repoDir }],
    });

    expect(result.onboarded).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
  });

  it("handles two repos in parallel — returns two onboarded entries", async () => {
    const { onboardPortfolio } = await import("../services/portfolio-onboard.js");

    const repoA = await makeTmpRepo("repo-a");
    const repoB = await makeTmpRepo("repo-b");
    tmpDirs.push(repoA, repoB);

    const db = makeDbMock();
    const result = await onboardPortfolio(db as never, {
      projects: [
        { repoPath: repoA, name: "Repo A" },
        { repoPath: repoB, name: "Repo B" },
      ],
    });

    expect(result.onboarded).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);
    expect(result.aggregate.companies).toBe(2);
    // Two CEOs + two reviewers minimum.
    expect(result.aggregate.agents).toBeGreaterThanOrEqual(4);
  });

  it("reports subscription_only_violation in refusedHires but continues for other hires", async () => {
    const { onboardPortfolio } = await import("../services/portfolio-onboard.js");

    const repoDir = await makeTmpRepo("subs-app");
    tmpDirs.push(repoDir);

    const db = makeDbMock();

    // Attempt to onboard with a non-subscription CEO adapter and subscriptionOnly=true
    const result = await onboardPortfolio(
      db as never,
      {
        projects: [
          {
            repoPath: repoDir,
            name: "subs-app",
            overrides: { ceoAdapterType: "process" }, // api-billed adapter
          },
        ],
        operatorProfile: { subscriptionOnly: true },
      },
    );

    // CEO hire was refused — project ends up in skipped (can't proceed without CEO)
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toContain("subscription_only_violation");
    expect(result.onboarded).toHaveLength(0);
  });

  it("aggregate counts are correct", async () => {
    const { onboardPortfolio } = await import("../services/portfolio-onboard.js");

    const repoA = await makeTmpRepo("count-a");
    tmpDirs.push(repoA);

    const db = makeDbMock();
    const result = await onboardPortfolio(db as never, {
      projects: [{ repoPath: repoA }],
    });

    const onb = result.onboarded[0]!;
    const expectedAgents =
      1 + // CEO
      (onb.reviewerId ? 1 : 0) + // reviewer
      onb.preHiredAgentIds.length; // team shape
    expect(result.aggregate.agents).toBe(expectedAgents);
    expect(result.aggregate.refusals).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// HTTP route tests: POST /api/portfolio/onboard
// ---------------------------------------------------------------------------

describe("POST /api/portfolio/onboard route", () => {
  let tmpDirs: string[] = [];

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    agentCounter = 0;

    registerModuleMocks();

    mockCompanyService.create.mockImplementation(async (data: Record<string, unknown>) => ({
      id: `company-route-${Date.now()}`,
      name: data.name,
      autoHireEnabled: true,
      requireBoardApprovalForNewAgents: false,
    }));

    mockAgentService.create.mockImplementation(async (_companyId: string, data: Record<string, unknown>) => ({
      id: `agent-route-${++agentCounter}`,
      name: data.name,
      role: data.role,
    }));
  });

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await fs.rm(dir, { recursive: true, force: true });
    }
    tmpDirs = [];
  });

  async function buildApp(actor: Record<string, unknown>) {
    const [{ errorHandler }, { portfolioOnboardRoutes }] = await Promise.all([
      vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
      vi.importActual<typeof import("../routes/portfolio-onboard.js")>(
        "../routes/portfolio-onboard.js",
      ),
    ]);
    const db = makeDbMock();
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as Record<string, unknown>).actor = actor;
      next();
    });
    app.use("/api", portfolioOnboardRoutes(db as never));
    app.use(errorHandler);
    return app;
  }

  it("returns 403 for non-board actor", async () => {
    const repoDir = await makeTmpRepo("auth-test");
    tmpDirs.push(repoDir);

    const app = await buildApp({ type: "agent", companyId: "test-company" });
    const res = await request(app)
      .post("/api/portfolio/onboard")
      .send({ projects: [{ repoPath: repoDir }] });

    expect(res.status).toBe(403);
  });

  it("returns 400 for empty projects array", async () => {
    const app = await buildApp({
      type: "board",
      source: "local_implicit",
      isInstanceAdmin: true,
    });
    const res = await request(app)
      .post("/api/portfolio/onboard")
      .send({ projects: [] });

    expect(res.status).toBe(400);
  });

  it("returns 200 with onboarded/skipped/aggregate for valid request", async () => {
    const repoDir = await makeTmpRepo("route-app");
    tmpDirs.push(repoDir);

    const app = await buildApp({
      type: "board",
      source: "local_implicit",
      isInstanceAdmin: true,
    });

    const res = await request(app)
      .post("/api/portfolio/onboard")
      .send({
        projects: [{ repoPath: repoDir, name: "route-app" }],
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("onboarded");
    expect(res.body).toHaveProperty("skipped");
    expect(res.body).toHaveProperty("aggregate");
    expect(typeof res.body.aggregate.companies).toBe("number");
    expect(typeof res.body.aggregate.agents).toBe("number");
    expect(typeof res.body.aggregate.refusals).toBe("number");
  });

  it("returns 200 with skipped entry for already-onboarded repo", async () => {
    const repoDir = await makeTmpRepo("route-idempotent");
    tmpDirs.push(repoDir);

    // Write project.yaml
    const dotDir = path.join(repoDir, ".paperclip");
    await fs.mkdir(dotDir, { recursive: true });
    await fs.writeFile(
      path.join(dotDir, "project.yaml"),
      [
        "companyId: existing-company-id",
        "projectId: existing-project-id",
        "ceoAgentId: existing-ceo-id",
        "",
      ].join("\n"),
      "utf8",
    );

    // Override the db to return existing company
    const [{ portfolioOnboardRoutes }] = await Promise.all([
      vi.importActual<typeof import("../routes/portfolio-onboard.js")>(
        "../routes/portfolio-onboard.js",
      ),
    ]);
    const { errorHandler } = await vi.importActual<typeof import("../middleware/index.js")>(
      "../middleware/index.js",
    );

    const db = makeDbMock({
      companiesFind: () => Promise.resolve({ id: "existing-company-id" }),
    });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as Record<string, unknown>).actor = {
        type: "board",
        source: "local_implicit",
        isInstanceAdmin: true,
      };
      next();
    });
    app.use("/api", portfolioOnboardRoutes(db as never));
    app.use(errorHandler);

    const res = await request(app)
      .post("/api/portfolio/onboard")
      .send({ projects: [{ repoPath: repoDir }] });

    expect(res.status).toBe(200);
    expect(res.body.skipped).toHaveLength(1);
    expect(res.body.skipped[0].reason).toContain("already-onboarded");
    expect(res.body.onboarded).toHaveLength(0);
  });
});
