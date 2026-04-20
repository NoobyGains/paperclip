import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { agentService, accessService } from "../services/index.js";

/**
 * GET /api/me
 *
 * Polymorphic identity endpoint — works for both board-user (API key or
 * session) and agent (API key or JWT) tokens.  Returns a `kind` discriminant
 * so callers don't have to guess which token type they're holding.
 */
export function meRoutes(db: Db) {
  const router = Router();

  router.get("/me", async (req, res) => {
    const actor = req.actor;

    if (actor.type === "none") {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    if (actor.type === "board") {
      res.json({
        kind: "board",
        userId: actor.userId,
        userName: actor.userName ?? null,
        userEmail: actor.userEmail ?? null,
        isInstanceAdmin: actor.isInstanceAdmin ?? false,
        companyIds: actor.companyIds ?? [],
        source: actor.source,
      });
      return;
    }

    // actor.type === "agent"
    if (!actor.agentId) {
      res.status(401).json({ error: "Agent authentication required" });
      return;
    }

    const svc = agentService(db);
    const agent = await svc.getById(actor.agentId);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    res.json({
      kind: "agent",
      ...agent,
    });
  });

  return router;
}
