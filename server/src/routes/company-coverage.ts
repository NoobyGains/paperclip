import { Router } from "express";
import { and, eq, inArray, ne, not } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, issues, issueLabels, labels } from "@paperclipai/db";
import { assertCompanyAccess } from "./authz.js";

/**
 * Static synonym map: maps an area label key to natural-language phrases that
 * imply the same coverage.  All comparisons are lower-case substring matches.
 */
export const LABEL_SYNONYMS: Record<string, string[]> = {
  "graph-api": ["microsoft graph", "msgraph", "ms graph"],
  "email": ["email pipeline", "email campaign", "mail pipeline"],
  "campaigns": ["email campaigns", "marketing campaigns", "campaign pipeline"],
  "sync": ["intune sync", "defender sync", "ms graph sync", "data sync"],
  "compliance": ["ce+", "cyber essentials", "audit trail"],
  "reporting": ["export", "csv export", "excel export", "pdf export"],
};

/**
 * Parse all `area:<word>` tokens out of a free-text capabilities string.
 * Also recognises natural-language synonyms defined in LABEL_SYNONYMS so that
 * e.g. "Microsoft Graph sync pipeline" counts as covering `area:graph-api`.
 */
export function parseAreaLabels(capabilities: string | null | undefined): string[] {
  if (!capabilities) return [];

  const lower = capabilities.toLowerCase();
  const found = new Set<string>();

  // 1. Exact area:X tokens.
  for (const [, key] of capabilities.matchAll(/area:(\w+)/g)) {
    found.add(`area:${key}`);
  }

  // 2. Natural-language synonyms.
  for (const [label, synonyms] of Object.entries(LABEL_SYNONYMS)) {
    if (synonyms.some((s) => lower.includes(s))) {
      found.add(`area:${label}`);
    }
  }

  return [...found];
}

export interface UncoveredLabel {
  label: string;
  issueCount: number;
  suggestedProfile: "coding-heavy";
}

/**
 * Lean coverage summary used by the CEO heartbeat context builder (#59).
 * Returns the top N uncovered `area:` labels sorted by issueCount desc.
 * Callers that need the full response (covered list, summary counts) should
 * hit GET /api/companies/:id/coverage instead.
 *
 * Restored after PR #90 merge inadvertently dropped this export — the #74
 * CEO-heartbeat wiring imports this function, so without it the server
 * module graph fails to load at boot.
 */
export async function buildCoverageSummary(
  db: Db,
  companyId: string,
  maxUncovered = 5,
): Promise<UncoveredLabel[]> {
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
