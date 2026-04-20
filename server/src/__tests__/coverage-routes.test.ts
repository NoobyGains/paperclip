import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@paperclipai/db";
import { companyCoverageRoutes, parseAreaLabels, LABEL_SYNONYMS } from "../routes/company-coverage.js";

// ---------------------------------------------------------------------------
// Pure-function tests — no DB needed
// ---------------------------------------------------------------------------

describe("parseAreaLabels", () => {
  it("extracts area: tokens from a capabilities string", () => {
    expect(parseAreaLabels("Owns area:backend and area:database issues.")).toEqual([
      "area:backend",
      "area:database",
    ]);
  });

  it("returns empty array for null/undefined/empty capabilities", () => {
    expect(parseAreaLabels(null)).toEqual([]);
    expect(parseAreaLabels(undefined)).toEqual([]);
    expect(parseAreaLabels("")).toEqual([]);
  });

  it("ignores non-area label tokens", () => {
    expect(parseAreaLabels("priority:high type:bug")).toEqual([]);
  });

  // --- synonym tests (#79) ---

  it("recognises 'Microsoft Graph sync pipeline' as covering area:graph-api", () => {
    const labels = parseAreaLabels("Microsoft Graph sync pipeline for Intune");
    expect(labels).toContain("area:graph-api");
  });

  it("does NOT treat unrelated capabilities (e.g. 'React') as covering area:graph-api", () => {
    const labels = parseAreaLabels("React frontend specialist");
    expect(labels).not.toContain("area:graph-api");
  });

  it("exact area:X tokens still work after synonym map was added (regression guard)", () => {
    expect(parseAreaLabels("area:backend area:database")).toEqual(
      expect.arrayContaining(["area:backend", "area:database"]),
    );
  });

  it("synonym map covers all documented keys", () => {
    // Ensures the exported map matches the labels mentioned in issue #79.
    expect(Object.keys(LABEL_SYNONYMS)).toEqual(
      expect.arrayContaining(["graph-api", "email", "campaigns", "sync", "compliance", "reporting"]),
    );
  });
});

// ---------------------------------------------------------------------------
// Route tests — mock DB
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
 * The coverage route runs exactly:
 *  1. db.select({id}).from(issues).where(...)                      → openIssueRows
 *  2. db.select({issueId,labelName}).from(issueLabels).innerJoin().where()  → labelRows
 *     (skipped when openIssueRows is empty)
 *  3. db.select({capabilities}).from(agents).where(...)            → agentRows
 */
function makeMockDb(
  openIssueRows: Array<{ id: string }>,
  labelRows: Array<{ issueId: string; labelName: string }>,
  agentRows: Array<{ capabilities: string | null }>,
): Db {
  const callResults: unknown[][] =
    openIssueRows.length === 0
      ? [openIssueRows, agentRows] // labels query is skipped when no open issues
      : [openIssueRows, labelRows, agentRows];
  let callIdx = 0;

  function makeChain(resultPromise: Promise<unknown>): Record<string, unknown> {
    const chain: Record<string, unknown> = {
      from: (_table: unknown) => makeChain(resultPromise),
      where: (_cond: unknown) => makeChain(resultPromise),
      innerJoin: (_table: unknown, _on: unknown) => makeChain(resultPromise),
      // Make the chain a thenable so `await chain` resolves to the result.
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
  app.use("/api/companies", companyCoverageRoutes(db));
  app.use(errorHandler);
  return app;
}

describe("GET /api/companies/:companyId/coverage", () => {
  beforeEach(() => {
    // nothing to reset — db is passed directly
  });

  it("returns empty uncoveredLabels when all area labels are covered", async () => {
    const db = makeMockDb(
      [{ id: "issue-1" }],
      [{ issueId: "issue-1", labelName: "area:backend" }],
      [{ capabilities: "Owns area:backend issues." }],
    );
    const app = await createApp(db);

    const res = await request(app).get("/api/companies/company-1/coverage");

    expect(res.status).toBe(200);
    expect(res.body.uncoveredLabels).toHaveLength(0);
    expect(res.body.coveredLabels).toContain("area:backend");
    expect(res.body.summary.openIssueCount).toBe(1);
    expect(res.body.summary.coveredCount).toBe(1);
    expect(res.body.summary.uncoveredCount).toBe(0);
  });

  it("includes uncovered area label with correct issueCount", async () => {
    const db = makeMockDb(
      [{ id: "issue-1" }, { id: "issue-2" }, { id: "issue-3" }],
      [
        { issueId: "issue-1", labelName: "area:frontend" },
        { issueId: "issue-2", labelName: "area:frontend" },
        { issueId: "issue-3", labelName: "area:frontend" },
      ],
      // agents only cover backend — frontend remains uncovered
      [{ capabilities: "Owns area:backend issues." }],
    );
    const app = await createApp(db);

    const res = await request(app).get("/api/companies/company-1/coverage");

    expect(res.status).toBe(200);
    expect(res.body.uncoveredLabels).toHaveLength(1);
    expect(res.body.uncoveredLabels[0].label).toBe("area:frontend");
    expect(res.body.uncoveredLabels[0].issueCount).toBe(3);
    expect(res.body.uncoveredLabels[0].suggestedProfile).toBe("coding-heavy");
    expect(res.body.summary.uncoveredCount).toBe(1);
  });

  it("ignores agents with no area: in capabilities", async () => {
    const db = makeMockDb(
      [{ id: "issue-1" }],
      [{ issueId: "issue-1", labelName: "area:data" }],
      // agents have no area: tokens — nothing is covered
      [{ capabilities: "General purpose engineer." }, { capabilities: null }],
    );
    const app = await createApp(db);

    const res = await request(app).get("/api/companies/company-1/coverage");

    expect(res.status).toBe(200);
    expect(res.body.coveredLabels).toHaveLength(0);
    expect(res.body.uncoveredLabels).toHaveLength(1);
    expect(res.body.uncoveredLabels[0].label).toBe("area:data");
  });
});
