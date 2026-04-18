import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { onboardPortfolio } from "../services/portfolio-onboard.js";
import { assertBoard } from "./authz.js";

const portfolioProjectSchema = z.object({
  repoPath: z.string().min(1).max(1024),
  name: z.string().min(1).max(120).optional(),
  overrides: z
    .object({
      name: z.string().min(1).max(120).optional(),
      ceoAdapterType: z.string().min(1).max(64).optional(),
      defaultHireAdapter: z.string().min(1).max(64).optional(),
    })
    .optional(),
});

const operatorProfileSchema = z.object({
  subscriptionOnly: z.boolean().optional(),
  claudeSubscription: z.string().nullable().optional(),
  codexSubscription: z.string().nullable().optional(),
});

const portfolioOnboardBodySchema = z.object({
  projects: z.array(portfolioProjectSchema).min(1).max(50),
  operatorProfile: operatorProfileSchema.optional(),
});

export function portfolioOnboardRoutes(db: Db) {
  const router = Router();

  router.post(
    "/portfolio/onboard",
    validate(portfolioOnboardBodySchema),
    async (req, res) => {
      assertBoard(req);

      // Derive the API URL from the request so project.yaml gets the right value.
      const proto = req.headers["x-forwarded-proto"] ?? req.protocol;
      const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost:3000";
      const apiUrl = `${proto}://${host}/api`;

      const result = await onboardPortfolio(db, req.body, apiUrl);
      res.json(result);
    },
  );

  return router;
}
