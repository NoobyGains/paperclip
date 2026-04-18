/**
 * Portfolio onboarding orchestrator — idempotently onboards a list of repos.
 *
 * Per-project flow:
 *  1. Detect archetype via detectArchetype(repoPath).
 *  2. Look up team shape via getTeamShape(archetype.stack).
 *  3. If no company exists for this repo yet, create one and configure it.
 *  4. Hire the CEO (direct-create, bypasses approval).
 *  5. Set projectId on the CEO.
 *  6. Hire reviewer via the hire-endpoint; set company.defaultReviewerAgentId.
 *  7. Pre-hire team-shape roles (CTO + engineers + QA per archetype).
 *  8. Write per-project CEO overlay via writeCeoOverlayFiles, seeded from archetype.
 *  9. Write .paperclip/project.yaml.
 * 10. Catch P1 subscription-only refusals and surface them as refusedHires — partial success.
 *
 * Idempotency: if .paperclip/project.yaml already exists in the repo and its companyId
 * / projectId are still live, skip re-onboarding and report status "already-onboarded".
 */

import fs from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, companies, projects, projectWorkspaces } from "@paperclipai/db";
import { getTeamShape } from "@paperclipai/shared";
import type { ProjectArchetype } from "@paperclipai/shared";
import { detectArchetype } from "./project-archetype.js";
import { writeCeoOverlayFiles } from "./ceo-overlay.js";
import { companyService } from "./companies.js";
import { agentService } from "./agents.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PortfolioProjectInput {
  repoPath: string;
  name?: string;
  overrides?: {
    name?: string;
    ceoAdapterType?: string;
    defaultHireAdapter?: string;
  };
}

export interface OperatorProfileInput {
  subscriptionOnly?: boolean;
  claudeSubscription?: string | null;
  codexSubscription?: string | null;
}

export interface PortfolioOnboardInput {
  projects: PortfolioProjectInput[];
  operatorProfile?: OperatorProfileInput;
}

export interface RefusedHire {
  role: string;
  adapter: string;
  reason: string;
}

export interface OnboardedProject {
  repoPath: string;
  companyId: string;
  projectId: string;
  ceoId: string;
  reviewerId: string | null;
  preHiredAgentIds: string[];
  overlayWritten: boolean;
  refusedHires: RefusedHire[];
}

export interface SkippedProject {
  repoPath: string;
  reason: string;
}

export interface PortfolioOnboardResult {
  onboarded: OnboardedProject[];
  skipped: SkippedProject[];
  aggregate: {
    companies: number;
    agents: number;
    refusals: number;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an AGENTS.md seed from the archetype descriptor. */
function buildAgentsMdSeed(archetype: ProjectArchetype, repoPath: string): string {
  const lines: string[] = [
    `# Project context`,
    ``,
    `**Stack:** ${archetype.stack}`,
  ];

  if (archetype.packageManager) {
    lines.push(`**Package manager:** ${archetype.packageManager}`);
  }
  if (archetype.testCommand) {
    lines.push(`**Tests:** \`${archetype.testCommand}\``);
  }
  if (archetype.buildCommand) {
    lines.push(`**Build:** \`${archetype.buildCommand}\``);
  }
  if (archetype.lintCommand) {
    lines.push(`**Lint:** \`${archetype.lintCommand}\``);
  }
  if (archetype.migrationCommand) {
    lines.push(`**Migrations:** \`${archetype.migrationCommand}\``);
  }
  if (archetype.archDocPath) {
    lines.push(`**Architecture doc:** \`${archetype.archDocPath}\``);
  }
  if (archetype.workspaces && archetype.workspaces.length > 0) {
    lines.push(`**Workspaces:** ${archetype.workspaces.join(", ")}`);
  }

  lines.push(``, `**Repo:** ${repoPath}`);
  lines.push(
    ``,
    `Use the commands above to run tests, lint, and build. Always check existing AGENTS.md / CLAUDE.md in the repo root for project-specific guidance.`,
  );

  return lines.join("\n");
}

/** Try to read existing .paperclip/project.yaml idempotency marker. */
async function readExistingProjectYaml(
  repoPath: string,
): Promise<{ companyId: string; projectId: string; ceoAgentId: string } | null> {
  const yamlPath = path.join(repoPath, ".paperclip", "project.yaml");
  let text: string;
  try {
    text = await fs.readFile(yamlPath, "utf8");
  } catch {
    return null;
  }

  const companyIdMatch = text.match(/^companyId:\s*(.+)$/m);
  const projectIdMatch = text.match(/^projectId:\s*(.+)$/m);
  const ceoAgentIdMatch = text.match(/^ceoAgentId:\s*(.+)$/m);

  if (!companyIdMatch || !projectIdMatch || !ceoAgentIdMatch) return null;

  return {
    companyId: companyIdMatch[1]!.trim(),
    projectId: projectIdMatch[1]!.trim(),
    ceoAgentId: ceoAgentIdMatch[1]!.trim(),
  };
}

/** Write .paperclip/project.yaml. */
async function writeProjectYaml(
  repoPath: string,
  data: { companyId: string; projectId: string; ceoAgentId: string; apiUrl: string },
): Promise<void> {
  const dotDir = path.join(repoPath, ".paperclip");
  await fs.mkdir(dotDir, { recursive: true });
  const yaml = [
    "# Paperclip project pointer — auto-generated by paperclipOnboardPortfolio",
    `# on ${new Date().toISOString()}`,
    `companyId: ${data.companyId}`,
    `projectId: ${data.projectId}`,
    `ceoAgentId: ${data.ceoAgentId}`,
    `paperclipApiUrl: ${data.apiUrl}`,
    "",
  ].join("\n");
  await fs.writeFile(path.join(dotDir, "project.yaml"), yaml, "utf8");
}

// ---------------------------------------------------------------------------
// Subscription-only guard (mirrors P1 server logic without HTTP round-trip)
// ---------------------------------------------------------------------------

/** Adapter billing modes — mirrors the billingMode field on server adapter modules. */
const SUBSCRIPTION_BILLING_ADAPTERS = new Set([
  "claude_local",
  "codex_local",
  "cursor_local",
  "openclaw_gateway",
  "pi_local",
  "gemini_local",
  "opencode_local",
]);

function isApiBilledAdapter(adapterType: string): boolean {
  return !SUBSCRIPTION_BILLING_ADAPTERS.has(adapterType);
}

// ---------------------------------------------------------------------------
// Core per-project onboard
// ---------------------------------------------------------------------------

interface OnboardSingleOptions {
  db: Db;
  input: PortfolioProjectInput;
  operatorProfile?: OperatorProfileInput;
  apiUrl: string;
}

async function onboardSingleProject(
  opts: OnboardSingleOptions,
): Promise<OnboardedProject | SkippedProject> {
  const { db, input, operatorProfile } = opts;
  const absoluteRepoPath = path.isAbsolute(input.repoPath)
    ? input.repoPath
    : path.resolve(process.cwd(), input.repoPath);

  const refusedHires: RefusedHire[] = [];

  // ── Idempotency check ──────────────────────────────────────────────────────
  const existing = await readExistingProjectYaml(absoluteRepoPath);
  if (existing) {
    // Verify the company still exists in the DB.
    const company = await db.query.companies.findFirst({
      where: eq(companies.id, existing.companyId),
    });
    if (company) {
      return {
        repoPath: absoluteRepoPath,
        reason: `already-onboarded (companyId=${existing.companyId}, projectId=${existing.projectId})`,
      } satisfies SkippedProject;
    }
    // Company was deleted — fall through to re-onboard.
  }

  // ── 1. Detect archetype ───────────────────────────────────────────────────
  const archetype = await detectArchetype(absoluteRepoPath);

  // ── 2. Look up team shape ─────────────────────────────────────────────────
  const teamShape = getTeamShape(archetype.stack);

  // ── 3. Determine CEO adapter ──────────────────────────────────────────────
  const ceoAdapterType = input.overrides?.ceoAdapterType ?? "claude_local";
  const defaultHireAdapter = input.overrides?.defaultHireAdapter ?? "codex_local";

  // Check subscription enforcement for the CEO adapter.
  const shouldEnforceSubscription =
    operatorProfile?.subscriptionOnly === true;

  if (shouldEnforceSubscription && isApiBilledAdapter(ceoAdapterType)) {
    refusedHires.push({
      role: "ceo",
      adapter: ceoAdapterType,
      reason: "subscription_only_violation — CEO adapter is API-billed",
    });
    return {
      repoPath: absoluteRepoPath,
      reason: `CEO hire refused: subscription_only_violation for adapter=${ceoAdapterType}`,
    } satisfies SkippedProject;
  }

  // ── 3. Create company ─────────────────────────────────────────────────────
  const derivedName = input.overrides?.name ?? input.name ?? path.basename(absoluteRepoPath);
  const svc = companyService(db);

  const company = await svc.create({
    name: `${derivedName} workspace`,
    requireBoardApprovalForNewAgents: false,
    autoHireEnabled: true,
    defaultHireAdapter,
    autoReviewEnabled: true,
  });

  const companyId = company.id;

  // ── 4. Create the CEO ─────────────────────────────────────────────────────
  const agentSvc = agentService(db);
  const ceo = await agentSvc.create(companyId, {
    name: "CEO",
    role: "ceo",
    title: "Chief Executive Officer",
    icon: "crown",
    adapterType: ceoAdapterType,
    adapterConfig: { cwd: absoluteRepoPath },
    runtimeConfig: {
      heartbeat: { enabled: false, wakeOnDemand: true },
    },
    permissions: { canCreateAgents: true },
    capabilities:
      "Owns strategy, prioritization, delegation, and hiring for this company.",
  });
  const ceoId = ceo.id;

  // ── 5. Create the project ─────────────────────────────────────────────────
  const [project] = await db
    .insert(projects)
    .values({
      companyId,
      name: derivedName,
      description: `Auto-onboarded project for ${derivedName}`,
    })
    .returning();
  const projectId = project!.id;

  // Create project workspace
  await db.insert(projectWorkspaces).values({
    companyId,
    projectId,
    name: derivedName,
    cwd: absoluteRepoPath,
    sourceType: "local_path",
    isPrimary: true,
  });

  // ── Set projectId on CEO ───────────────────────────────────────────────────
  await db
    .update(agents)
    .set({ projectId })
    .where(eq(agents.id, ceoId));

  // ── 6. Hire reviewer ──────────────────────────────────────────────────────
  let reviewerId: string | null = null;
  const reviewerAdapterType = "claude_local"; // reviewer profile always uses claude_local
  if (shouldEnforceSubscription && isApiBilledAdapter(reviewerAdapterType)) {
    refusedHires.push({
      role: "reviewer",
      adapter: reviewerAdapterType,
      reason: "subscription_only_violation — reviewer adapter is API-billed",
    });
  } else {
    try {
      const reviewer = await agentSvc.create(companyId, {
        name: "Reviewer",
        role: "reviewer",
        title: "Senior Code Reviewer",
        icon: "magnifying-glass",
        adapterType: reviewerAdapterType,
        adapterConfig: { cwd: absoluteRepoPath },
        runtimeConfig: {
          heartbeat: { enabled: false, wakeOnDemand: true },
        },
        permissions: { canCreateAgents: false },
        capabilities: "Reviews pull requests, issue resolutions, and code quality.",
      });
      reviewerId = reviewer.id;

      // Set defaultReviewerAgentId on the company.
      await db
        .update(companies)
        .set({ defaultReviewerAgentId: reviewerId })
        .where(eq(companies.id, companyId));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("subscription_only_violation")) {
        refusedHires.push({
          role: "reviewer",
          adapter: reviewerAdapterType,
          reason: msg,
        });
      } else {
        throw err;
      }
    }
  }

  // ── 7. Pre-hire team-shape roles ──────────────────────────────────────────
  // Team shape from R1 already includes a reviewer slot. We skip it here
  // because we already hired the reviewer above. Also skip CEO (not in shape).
  const preHiredAgentIds: string[] = [];

  for (const slot of teamShape.roles) {
    if (slot.role === "reviewer") continue; // already done above

    // Map profile to adapter type
    const adapterTypeForSlot = slot.profile.startsWith("coding") ? "codex_local" : "claude_local";

    if (shouldEnforceSubscription && isApiBilledAdapter(adapterTypeForSlot)) {
      refusedHires.push({
        role: slot.role,
        adapter: adapterTypeForSlot,
        reason: "subscription_only_violation — adapter is API-billed",
      });
      continue;
    }

    try {
      const agentName = slot.name ?? slot.role.charAt(0).toUpperCase() + slot.role.slice(1);
      const hired = await agentSvc.create(companyId, {
        name: agentName,
        role: slot.role,
        adapterType: adapterTypeForSlot,
        adapterConfig: { cwd: absoluteRepoPath },
        runtimeConfig: {
          heartbeat: { enabled: false, wakeOnDemand: true },
        },
        permissions: { canCreateAgents: false },
        capabilities: `${agentName} — hired from team shape for ${archetype.stack} archetype.`,
      });
      preHiredAgentIds.push(hired.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("subscription_only_violation")) {
        refusedHires.push({
          role: slot.role,
          adapter: adapterTypeForSlot,
          reason: msg,
        });
      } else {
        throw err;
      }
    }
  }

  // ── 8. Write CEO overlay ──────────────────────────────────────────────────
  let overlayWritten = false;
  try {
    const agentsMd = buildAgentsMdSeed(archetype, absoluteRepoPath);
    await writeCeoOverlayFiles(absoluteRepoPath, { "AGENTS.md": agentsMd });
    overlayWritten = true;
  } catch {
    // Non-fatal — report but continue.
    overlayWritten = false;
  }

  // ── 9. Write .paperclip/project.yaml ─────────────────────────────────────
  try {
    await writeProjectYaml(absoluteRepoPath, {
      companyId,
      projectId,
      ceoAgentId: ceoId,
      apiUrl: opts.apiUrl,
    });
  } catch {
    // Non-fatal — idempotency check still works next time via DB.
  }

  return {
    repoPath: absoluteRepoPath,
    companyId,
    projectId,
    ceoId,
    reviewerId,
    preHiredAgentIds,
    overlayWritten,
    refusedHires,
  } satisfies OnboardedProject;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function onboardPortfolio(
  db: Db,
  input: PortfolioOnboardInput,
  apiUrl = "http://localhost:3000/api",
): Promise<PortfolioOnboardResult> {
  const onboarded: OnboardedProject[] = [];
  const skipped: SkippedProject[] = [];

  for (const project of input.projects) {
    const result = await onboardSingleProject({
      db,
      input: project,
      operatorProfile: input.operatorProfile,
      apiUrl,
    });

    // Discriminate by whether the result has companyId (OnboardedProject) or reason (SkippedProject)
    if ("companyId" in result) {
      onboarded.push(result);
    } else {
      skipped.push(result);
    }
  }

  const totalAgents = onboarded.reduce(
    (sum, o) => sum + 1 + (o.reviewerId ? 1 : 0) + o.preHiredAgentIds.length,
    0,
  );
  const totalRefusals = onboarded.reduce((sum, o) => sum + o.refusedHires.length, 0);

  return {
    onboarded,
    skipped,
    aggregate: {
      companies: onboarded.length,
      agents: totalAgents,
      refusals: totalRefusals,
    },
  };
}
