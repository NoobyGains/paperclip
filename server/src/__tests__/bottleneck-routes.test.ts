import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@paperclipai/db";
import { companyBottlenecksRoutes } from "../routes/company-bottlenecks.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function boardActor() {
  return {
    type: "board",
    userId: "user-1",
    source: "local_implicit",
    isInstanceAdmin: true,
    companyIds: ["company-1"],
  };
}

/**
 * Build a mock Db where db.select() calls return results in sequence.
 *
 * The bottlenecks route runs exactly two queries in order:
 *  1. db.select({id, name, role}).from(agents).where(...)   → agentRows
 *  2. db.select({...}).from(issues).where(...)              → issueRows
 */
function makeMockDb(
  agentRows: Array<{ id: string; name: string; role: string }>,
  issueRows: Array<{
    id: string;
    title: string;
    identifier: string | null;
    status: string;
    assigneeAgentId: string | null;
    updatedAt: Date;
    executionPolicy: Record<string, unknown> | null;
  }>,
): Db {
  const callResults: unknown[][] = [agentRows, issueRows];
  let callIdx = 0;

  function makeChain(resultPromise: Promise<unknown>): Record<string, unknown> {
    const chain: Record<string, unknown> = {
      from: (_table: unknown) => makeChain(resultPromise),
      where: (_cond: unknown) => makeChain(resultPromise),
      then: (
        onFulfilled?: ((value: unknown) => unknown) | null,
        onRejected?: ((reason: unknown) => unknown) | null,
      ) => resultPromise.then(onFulfilled, onRejected ?? undefined),
      catch: (onRejected?: ((reason: unknown) => unknown) | null) =>
        resultPromise.catch(onRejected ?? undefined),
      finally: (onFinally?: (() => void) | null) =>
        resultPromise.finally(onFinally ?? undefined),
    };
    return chain;
  }

  return {
    select: (_fields?: unknown) => {
      const idx = callIdx++;
      const result = callResults[idx] ?? [];
      return makeChain(Promise.resolve(result));
    },
  } as unknown as Db;
}

async function createApp(db: Db) {
  const { errorHandler } = await import("../middleware/index.js");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = boardActor();
    next();
  });
  app.use("/api/companies", companyBottlenecksRoutes(db));
  app.use(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/companies/:companyId/bottlenecks", () => {
  beforeEach(() => {
    // nothing to reset
  });

  it("returns reviewQueue entry when a reviewer has 4 pending in_review issues", async () => {
    const reviewerAgent = { id: "agent-reviewer-1", name: "Alice Reviewer", role: "reviewer" };
    const reviewPolicy = {
      mode: "normal",
      commentRequired: true,
      stages: [
        {
          id: "stage-1",
          type: "review",
          approvalsNeeded: 1,
          participants: [{ id: "p-1", type: "agent", agentId: "agent-reviewer-1", userId: null }],
        },
      ],
    };

    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60_000);

    const issueRows = Array.from({ length: 4 }, (_, i) => ({
      id: `issue-${i + 1}`,
      title: `Issue ${i + 1}`,
      identifier: `PAP-${i + 1}`,
      status: "in_review",
      assigneeAgentId: null,
      updatedAt: fiveMinutesAgo,
      executionPolicy: reviewPolicy,
    }));

    const db = makeMockDb([reviewerAgent], issueRows);
    const app = await createApp(db);

    const res = await request(app).get("/api/companies/company-1/bottlenecks");

    expect(res.status).toBe(200);
    expect(res.body.reviewQueue).toHaveLength(1);
    expect(res.body.reviewQueue[0].reviewerAgentId).toBe("agent-reviewer-1");
    expect(res.body.reviewQueue[0].reviewerName).toBe("Alice Reviewer");
    expect(res.body.reviewQueue[0].pendingIssueCount).toBe(4);
    expect(typeof res.body.reviewQueue[0].oldestPendingMinutes).toBe("number");
  });

  it("returns overloadedAgents entry when an engineer has 3 active assignments", async () => {
    const engineerAgent = { id: "agent-eng-1", name: "Bob Engineer", role: "coding" };
    const now = new Date();
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60_000);

    const issueRows = Array.from({ length: 3 }, (_, i) => ({
      id: `issue-${i + 1}`,
      title: `Issue ${i + 1}`,
      identifier: `PAP-${i + 10}`,
      status: i === 0 ? "in_progress" : i === 1 ? "todo" : "in_review",
      assigneeAgentId: "agent-eng-1",
      updatedAt: tenMinutesAgo,
      executionPolicy: null,
    }));

    const db = makeMockDb([engineerAgent], issueRows);
    const app = await createApp(db);

    const res = await request(app).get("/api/companies/company-1/bottlenecks");

    expect(res.status).toBe(200);
    expect(res.body.overloadedAgents).toHaveLength(1);
    expect(res.body.overloadedAgents[0].agentId).toBe("agent-eng-1");
    expect(res.body.overloadedAgents[0].name).toBe("Bob Engineer");
    expect(res.body.overloadedAgents[0].activeAssignmentCount).toBe(3);
  });

  it("returns stuckInReview entry for issue stuck > 30 minutes", async () => {
    const now = new Date();
    const fortyMinutesAgo = new Date(now.getTime() - 40 * 60_000);

    const issueRows = [
      {
        id: "issue-stuck-1",
        title: "Stuck Issue",
        identifier: "PAP-99",
        status: "in_review",
        assigneeAgentId: null,
        updatedAt: fortyMinutesAgo,
        executionPolicy: null,
      },
    ];

    const db = makeMockDb([], issueRows);
    const app = await createApp(db);

    const res = await request(app).get("/api/companies/company-1/bottlenecks");

    expect(res.status).toBe(200);
    expect(res.body.stuckInReview).toHaveLength(1);
    expect(res.body.stuckInReview[0].issueId).toBe("issue-stuck-1");
    expect(res.body.stuckInReview[0].identifier).toBe("PAP-99");
    expect(res.body.stuckInReview[0].title).toBe("Stuck Issue");
    expect(res.body.stuckInReview[0].minutesInReview).toBeGreaterThanOrEqual(39);
    // criticalCount should include this stuck entry
    expect(res.body.summary.criticalCount).toBeGreaterThanOrEqual(1);
  });

  it("returns empty arrays and criticalCount=0 for a fully-flowing company", async () => {
    const engineerAgent = { id: "agent-eng-1", name: "Carol Engineer", role: "coding" };
    const now = new Date();
    const twoMinutesAgo = new Date(now.getTime() - 2 * 60_000);

    // Only 1 active assignment — not overloaded
    const issueRows = [
      {
        id: "issue-flowing-1",
        title: "In-flight Issue",
        identifier: "PAP-5",
        status: "in_progress",
        assigneeAgentId: "agent-eng-1",
        updatedAt: twoMinutesAgo,
        executionPolicy: null,
      },
    ];

    const db = makeMockDb([engineerAgent], issueRows);
    const app = await createApp(db);

    const res = await request(app).get("/api/companies/company-1/bottlenecks");

    expect(res.status).toBe(200);
    expect(res.body.reviewQueue).toHaveLength(0);
    expect(res.body.overloadedAgents).toHaveLength(0);
    expect(res.body.stuckInReview).toHaveLength(0);
    expect(res.body.summary.criticalCount).toBe(0);
  });
});
