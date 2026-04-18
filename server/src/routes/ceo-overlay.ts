import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { asc, desc, eq } from "drizzle-orm";
import { agents as agentsTable, projects, projectWorkspaces } from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { writeCeoOverlayFiles, refineCeoOverlayFiles } from "../services/index.js";
import { assertBoard } from "./authz.js";

const writeOverlayBodySchema = z.object({
  files: z.object({
    "AGENTS.md": z.string().optional(),
    "HEARTBEAT.md": z.string().optional(),
    "SOUL.md": z.string().optional(),
    "TOOLS.md": z.string().optional(),
  }).refine((v) => Object.keys(v).length > 0, { message: "at least one file required" }),
});

const refineOverlayBodySchema = z.object({
  proposedChanges: z.object({
    "AGENTS.md": z.string().optional(),
    "HEARTBEAT.md": z.string().optional(),
    "SOUL.md": z.string().optional(),
    "TOOLS.md": z.string().optional(),
  }).refine((v) => Object.keys(v).length > 0, { message: "at least one file required" }),
});

export function ceoOverlayRoutes(db: Db) {
  const router = Router();

  router.post(
    "/projects/:projectId/ceo-overlay",
    validate(writeOverlayBodySchema),
    async (req, res) => {
      assertBoard(req);
      const projectId = req.params.projectId as string;
      const project = await db.query.projects.findFirst({
        where: eq(projects.id, projectId),
      });
      if (!project) {
        res.status(404).json({ error: "project_not_found" });
        return;
      }
      const workspace = await db
        .select()
        .from(projectWorkspaces)
        .where(eq(projectWorkspaces.projectId, projectId))
        .orderBy(desc(projectWorkspaces.isPrimary), asc(projectWorkspaces.createdAt))
        .limit(1)
        .then((rows) => rows[0] ?? null);
      const repoPath = workspace?.cwd;
      if (!repoPath) {
        res.status(409).json({ error: "project_has_no_workspace_cwd" });
        return;
      }
      const written = await writeCeoOverlayFiles(repoPath, req.body.files);
      res.json({ written, repoPath });
    },
  );

  // POST /api/agents/:agentId/ceo-overlay/refine
  // Resolve agent -> projectId -> repoPath, then write proposed changes with history.
  router.post(
    "/agents/:agentId/ceo-overlay/refine",
    validate(refineOverlayBodySchema),
    async (req, res) => {
      assertBoard(req);
      const agentId = req.params.agentId as string;

      const agent = await db.query.agents.findFirst({
        where: eq(agentsTable.id, agentId),
      });
      if (!agent) {
        res.status(404).json({ error: "agent_not_found" });
        return;
      }
      if (!agent.projectId) {
        res.status(404).json({ error: "agent_has_no_project" });
        return;
      }

      const workspace = await db
        .select()
        .from(projectWorkspaces)
        .where(eq(projectWorkspaces.projectId, agent.projectId))
        .orderBy(desc(projectWorkspaces.isPrimary), asc(projectWorkspaces.createdAt))
        .limit(1)
        .then((rows) => rows[0] ?? null);

      const repoPath = workspace?.cwd;
      if (!repoPath) {
        res.status(404).json({ error: "project_has_no_workspace_cwd" });
        return;
      }

      const result = await refineCeoOverlayFiles(repoPath, req.body.proposedChanges);
      res.json(result);
    },
  );

  return router;
}
