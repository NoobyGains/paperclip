import { Router, type Request, type Response } from "express";
import type { Db } from "@paperclipai/db";
import { updateUserProfileSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { userProfileService } from "../services/index.js";
import { assertBoard } from "./authz.js";

function requireBoardUserId(req: Request, res: Response): string | null {
  assertBoard(req);
  if (!req.actor.userId) {
    res.status(403).json({ error: "Board user context required" });
    return null;
  }
  return req.actor.userId;
}

export function meProfileRoutes(db: Db) {
  const router = Router();
  const svc = userProfileService(db);

  router.get("/me/profile", async (req, res) => {
    const userId = requireBoardUserId(req, res);
    if (!userId) return;
    res.json(await svc.getProfile(userId));
  });

  router.patch("/me/profile", validate(updateUserProfileSchema), async (req, res) => {
    const userId = requireBoardUserId(req, res);
    if (!userId) return;
    res.json(await svc.updateProfile(userId, req.body));
  });

  return router;
}
