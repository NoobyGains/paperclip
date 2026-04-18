import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { detectArchetype } from "../services/index.js";
import { assertBoard } from "./authz.js";

const detectRequestSchema = z.object({
  repoPath: z.string().min(1).max(1024),
});

export function projectArchetypeRoutes() {
  const router = Router();

  router.post("/project-archetype/detect", validate(detectRequestSchema), async (req, res) => {
    assertBoard(req);
    const archetype = await detectArchetype(req.body.repoPath as string);
    res.json(archetype);
  });

  return router;
}
