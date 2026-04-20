import { Router } from "express";
import { and, eq, inArray, ne, not } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, issues } from "@paperclipai/db";
import { assertCompanyAccess } from "./authz.js";
import { normalizeIssueExecutionPolicy } from "../services/issue-execution-policy.js";

const ACTIVE_STATUSES = ["in_progress", "todo", "in_review"] as const;
const STUCK_THRESHOLD_MINUTES = 30;

export function companyBottlenecksRoutes(db: Db) {
  const router = Router();

  router.get("/:companyId/bottlenecks", async (req, res) => {
    const { companyId } = req.params as { companyId: string };
    assertCompanyAccess(req, companyId);

    const now = new Date();

    // 1. Fetch all non-terminated agents for this company.
    const allAgents = await db
      .select({
        id: agents.id,
        name: agents.name,
        role: agents.role,
      })
      .from(agents)
      .where(
        and(
          eq(agents.companyId, companyId),
          ne(agents.status, "terminated"),
        ),
      );

    const reviewerAgents = allAgents.filter((a) => a.role === "reviewer");
    const nonReviewerAgents = allAgents.filter((a) => a.role !== "reviewer" && a.role !== "ceo");

    // 2. Fetch all active + in_review issues for this company.
    const activeIssueRows = await db
      .select({
        id: issues.id,
        title: issues.title,
        identifier: issues.identifier,
        status: issues.status,
        assigneeAgentId: issues.assigneeAgentId,
        updatedAt: issues.updatedAt,
        executionPolicy: issues.executionPolicy,
      })
      .from(issues)
      .where(
        and(
          eq(issues.companyId, companyId),
          inArray(issues.status, [...ACTIVE_STATUSES]),
        ),
      );

    // 3. Compute reviewQueue — for each reviewer, find issues in in_review
    //    where that reviewer appears in the policy's review stage participants.
    const reviewQueue: Array<{
      reviewerAgentId: string;
      reviewerName: string;
      pendingIssueCount: number;
      oldestPendingMinutes: number;
    }> = [];

    const inReviewIssues = activeIssueRows.filter((i) => i.status === "in_review");

    for (const reviewer of reviewerAgents) {
      const pendingIssues = inReviewIssues.filter((issue) => {
        const policy = normalizeIssueExecutionPolicy(issue.executionPolicy);
        if (!policy) return false;
        for (const stage of policy.stages) {
          if (stage.type !== "review") continue;
          for (const participant of stage.participants) {
            if (participant.type === "agent" && participant.agentId === reviewer.id) {
              return true;
            }
          }
        }
        return false;
      });

      if (pendingIssues.length === 0) continue;

      const oldestUpdatedAt = pendingIssues.reduce(
        (oldest, issue) => (issue.updatedAt < oldest ? issue.updatedAt : oldest),
        pendingIssues[0].updatedAt,
      );
      const oldestPendingMinutes = Math.round(
        (now.getTime() - oldestUpdatedAt.getTime()) / 60_000,
      );

      reviewQueue.push({
        reviewerAgentId: reviewer.id,
        reviewerName: reviewer.name,
        pendingIssueCount: pendingIssues.length,
        oldestPendingMinutes,
      });
    }

    // Sort by pendingIssueCount desc, then oldestPendingMinutes desc.
    reviewQueue.sort(
      (a, b) => b.pendingIssueCount - a.pendingIssueCount || b.oldestPendingMinutes - a.oldestPendingMinutes,
    );

    // 4. Compute overloadedAgents — non-reviewer, non-ceo agents with ≥3 active issues.
    const overloadedAgents: Array<{
      agentId: string;
      name: string;
      activeAssignmentCount: number;
    }> = [];

    for (const agent of nonReviewerAgents) {
      const activeCount = activeIssueRows.filter(
        (i) => i.assigneeAgentId === agent.id,
      ).length;
      if (activeCount >= 3) {
        overloadedAgents.push({
          agentId: agent.id,
          name: agent.name,
          activeAssignmentCount: activeCount,
        });
      }
    }

    // Sort by activeAssignmentCount desc.
    overloadedAgents.sort((a, b) => b.activeAssignmentCount - a.activeAssignmentCount);

    // 5. Compute stuckInReview — in_review issues stale >= 30 minutes.
    const stuckInReview: Array<{
      issueId: string;
      identifier: string | null;
      title: string;
      minutesInReview: number;
    }> = [];

    for (const issue of inReviewIssues) {
      const minutesInReview = Math.round(
        (now.getTime() - issue.updatedAt.getTime()) / 60_000,
      );
      if (minutesInReview >= STUCK_THRESHOLD_MINUTES) {
        stuckInReview.push({
          issueId: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          minutesInReview,
        });
      }
    }

    // Sort by minutesInReview desc.
    stuckInReview.sort((a, b) => b.minutesInReview - a.minutesInReview);

    // 6. Summary counts.
    const criticalCount =
      reviewQueue.filter((r) => r.pendingIssueCount >= 3).length +
      stuckInReview.length;
    const warnCount =
      reviewQueue.filter((r) => r.pendingIssueCount < 3).length +
      overloadedAgents.length;

    res.json({
      reviewQueue,
      overloadedAgents,
      stuckInReview,
      summary: { criticalCount, warnCount },
    });
  });

  return router;
}
