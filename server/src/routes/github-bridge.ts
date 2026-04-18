import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { forbidden, unauthorized } from "../errors.js";
import { accessService, agentService, logActivity, projectService } from "../services/index.js";
import { githubIssueBridge } from "../services/github-issue-bridge.js";

export function githubBridgeRoutes(db: Db) {
  const router = Router();
  const projects = projectService(db);
  const bridge = githubIssueBridge(db);
  const access = accessService(db);
  const agentsSvc = agentService(db);

  /**
   * Mirrors the tasks:assign permission gate from the direct createIssue route.
   * Called before the bridge is allowed to create issues assigned to a non-self
   * agent — prevents privilege escalation via the sync endpoint.
   */
  async function assertCanAssignTasks(req: Parameters<typeof getActorInfo>[0], companyId: string) {
    assertCompanyAccess(req, companyId);
    if (req.actor.type === "board") {
      if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) return;
      const allowed = await access.canUser(companyId, req.actor.userId, "tasks:assign");
      if (!allowed) throw forbidden("Missing permission: tasks:assign");
      return;
    }
    if (req.actor.type === "agent") {
      if (!req.actor.agentId) throw forbidden("Agent authentication required");
      const allowedByGrant = await access.hasPermission(companyId, "agent", req.actor.agentId, "tasks:assign");
      if (allowedByGrant) return;
      const actorAgent = await agentsSvc.getById(req.actor.agentId);
      const canCreateAgents =
        actorAgent &&
        actorAgent.companyId === companyId &&
        (actorAgent.role === "ceo" ||
          Boolean((actorAgent.permissions as Record<string, unknown> | null | undefined)?.canCreateAgents));
      if (canCreateAgents) return;
      throw forbidden("Missing permission: tasks:assign");
    }
    throw unauthorized();
  }

  router.post("/projects/:id/github-issues/sync", async (req, res) => {
    const projectId = req.params.id as string;
    const project = await projects.getById(projectId);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    assertCompanyAccess(req, project.companyId);
    const actor = getActorInfo(req);

    const result = await bridge.syncProject(projectId, {
      actor: {
        actorId: actor.actorId,
        agentId: actor.agentId,
      },
      // Gate non-self assignments behind tasks:assign — same rule as createIssue.
      assertCanAssignTo: async (_assigneeAgentId) => {
        await assertCanAssignTasks(req, project.companyId);
      },
    });

    await logActivity(db, {
      companyId: project.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "project.github_issue_bridge_synced",
      entityType: "project",
      entityId: project.id,
      details: {
        imported: result.imported,
        skippedAlreadyMirrored: result.skippedAlreadyMirrored,
        createdIssueIds: result.createdIssueIds,
        warnings: result.warnings,
      },
    });

    res.json(result);
  });

  return router;
}
