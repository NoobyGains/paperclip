import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { logActivity, projectService } from "../services/index.js";
import { githubIssueBridge } from "../services/github-issue-bridge.js";

export function githubBridgeRoutes(db: Db) {
  const router = Router();
  const projects = projectService(db);
  const bridge = githubIssueBridge(db);

  router.post("/projects/:id/github-issues/sync", async (req, res) => {
    const projectId = req.params.id as string;
    const project = await projects.getById(projectId);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    assertCompanyAccess(req, project.companyId);
    const actor = getActorInfo(req);
    const result = await bridge.syncProject(project.id, {
      actorId: actor.actorId,
      agentId: actor.agentId,
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
