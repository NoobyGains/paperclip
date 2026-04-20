import { Router } from "express";
import { and, eq, inArray, ne, not } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, issues, issueLabels, labels } from "@paperclipai/db";
import { assertCompanyAccess } from "./authz.js";

/** Parse all `area:<word>` tokens out of a free-text capabilities string. */
export function parseAreaLabels(capabilities: string | null | undefined): string[] {
  if (!capabilities) return [];
  const matches = capabilities.matchAll(/area:(\w+)/g);
  return [...matches].map((m) => `area:${m[1]}`);
}

export interface UncoveredLabel {
  label: string;
  issueCount: number;
  suggestedProfile: "coding-heavy";
}

/**
 * Compute coverage data for a company: which area: labels on open issues
 * have no specialist agent claiming them.
 *
 * Returns top uncovered labels (descending by issueCount), capped at `maxUncovered`.
 */
export async function buildCoverageSummary(
  db: Db,
  companyId: string,
  maxUncovered = 5,
): Promise<UncoveredLabel[]> {
  // 1. Fetch IDs of all open issues (status ∉ done, cancelled).
  const openIssueRows = await db
    .select({ id: issues.id })
    .from(issues)
    .where(
      and(
        eq(issues.companyId, companyId),
        not(inArray(issues.status, ["done", "cancelled"])),
      ),
    );

  const openIssueIds = openIssueRows.map((r) => r.id);
  if (openIssueIds.length === 0) return [];

  // 2. Build label-count map for area: labels on open issues.
  const labelCounts = new Map<string, number>();
  const labelRows = await db
    .select({
      issueId: issueLabels.issueId,
      labelName: labels.name,
    })
    .from(issueLabels)
    .innerJoin(labels, eq(issueLabels.labelId, labels.id))
    .where(
      and(
        eq(issueLabels.companyId, companyId),
        inArray(issueLabels.issueId, openIssueIds),
      ),
    );

  for (const row of labelRows) {
    if (!row.labelName.startsWith("area:")) continue;
    labelCounts.set(row.labelName, (labelCounts.get(row.labelName) ?? 0) + 1);
  }

  if (labelCounts.size === 0) return [];

  // 3. Find covered labels from non-CEO, non-reviewer active agents.
  const specialistAgents = await db
    .select({ capabilities: agents.capabilities })
    .from(agents)
    .where(
      and(
        eq(agents.companyId, companyId),
        not(inArray(agents.role, ["ceo", "reviewer"])),
        ne(agents.status, "terminated"),
      ),
    );

  const coveredSet = new Set<string>();
  for (const agent of specialistAgents) {
    for (const label of parseAreaLabels(agent.capabilities)) {
      coveredSet.add(label);
    }
  }

  // 4. Return top uncovered labels sorted by issueCount desc, capped.
  return [...labelCounts.entries()]
    .filter(([label]) => !coveredSet.has(label))
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxUncovered)
    .map(([label, count]) => ({
      label,
      issueCount: count,
      suggestedProfile: "coding-heavy" as const,
    }));
}

export function companyCoverageRoutes(db: Db) {
  const router = Router();

  router.get("/:companyId/coverage", async (req, res) => {
    const { companyId } = req.params as { companyId: string };
    assertCompanyAccess(req, companyId);

    // 1. Fetch IDs of all open issues (status ∉ done, cancelled).
    const openIssueRows = await db
      .select({ id: issues.id })
      .from(issues)
      .where(
        and(
          eq(issues.companyId, companyId),
          not(inArray(issues.status, ["done", "cancelled"])),
        ),
      );

    const openIssueIds = openIssueRows.map((r) => r.id);

    // 2. Build label-count map for area: labels on open issues.
    const labelCounts = new Map<string, number>();

    if (openIssueIds.length > 0) {
      const labelRows = await db
        .select({
          issueId: issueLabels.issueId,
          labelName: labels.name,
        })
        .from(issueLabels)
        .innerJoin(labels, eq(issueLabels.labelId, labels.id))
        .where(
          and(
            eq(issueLabels.companyId, companyId),
            inArray(issueLabels.issueId, openIssueIds),
          ),
        );

      for (const row of labelRows) {
        if (!row.labelName.startsWith("area:")) continue;
        labelCounts.set(row.labelName, (labelCounts.get(row.labelName) ?? 0) + 1);
      }
    }

    // 3. Find covered labels from non-CEO, non-reviewer active agents.
    const specialistAgents = await db
      .select({ capabilities: agents.capabilities })
      .from(agents)
      .where(
        and(
          eq(agents.companyId, companyId),
          not(inArray(agents.role, ["ceo", "reviewer"])),
          ne(agents.status, "terminated"),
        ),
      );

    const coveredSet = new Set<string>();
    for (const agent of specialistAgents) {
      for (const label of parseAreaLabels(agent.capabilities)) {
        coveredSet.add(label);
      }
    }

    // 4. Build response.
    const labelCountList = [...labelCounts.entries()].map(([label, count]) => ({ label, count }));

    const coveredLabels = [...coveredSet].filter((l) => labelCounts.has(l)).sort();

    const uncoveredLabels = labelCountList
      .filter((entry) => !coveredSet.has(entry.label))
      .sort((a, b) => b.count - a.count)
      .map((entry) => ({
        label: entry.label,
        issueCount: entry.count,
        suggestedProfile: "coding-heavy" as const,
      }));

    res.json({
      labelCounts: labelCountList,
      coveredLabels,
      uncoveredLabels,
      summary: {
        openIssueCount: openIssueIds.length,
        coveredCount: coveredLabels.length,
        uncoveredCount: uncoveredLabels.length,
      },
    });
  });

  return router;
}
