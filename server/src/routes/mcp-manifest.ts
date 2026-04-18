import { Router } from "express";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const serverPackage = require("../../package.json") as { version?: string };

const MCP_MANIFEST_VERSION = "2026-04-18";

/**
 * Endpoint list the MCP server should understand. The MCP package compares
 * its local tool surface to this list on startup and warns on mismatch.
 * Keep entries short (feature areas), not one-per-endpoint.
 */
const SUPPORTED_FEATURES = [
  "issues.crud",
  "issues.comments",
  "issues.documents",
  "issues.checkout",
  "issues.executionLockRecovery",
  "agents.read",
  "agents.hire",
  "approvals.crud",
  "approvals.decide",
  "routines.read",
  "companies.settings",
  "companies.skills",
  "companies.portabilityPreview",
  "llms.operatorContext",
] as const;

export function mcpManifestRoutes() {
  const router = Router();

  router.get("/mcp/manifest", (_req, res) => {
    res.json({
      manifestVersion: MCP_MANIFEST_VERSION,
      serverVersion: serverPackage.version ?? "unknown",
      features: [...SUPPORTED_FEATURES],
      notes: [
        "This endpoint is intentionally small — it exists so MCP clients can detect server/client drift.",
        "Feature keys are stable identifiers; new capabilities append entries.",
      ],
    });
  });

  return router;
}
